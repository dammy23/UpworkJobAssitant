import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { AiProviderId } from '../db/schema.js';
import { credentialsOf, type ProviderCredentials, usableProviders } from '../services/providers.js';
import {
  draftingMessages,
  rewriteMessages,
  scoringMessages,
  type ApplierContext,
  type ChatMessage,
  type PromptJob,
  type RewriteInstruction,
} from './prompts.js';

export interface ScoreResult {
  score: number;
  reasons: string;
  redFlags: string;
  model: string;
}

export interface TextResult {
  text: string;
  model: string;
}

/** Scores, drafts and rewrites. One implementation per provider. */
export interface Llm {
  readonly name: string;
  score(ctx: ApplierContext, job: PromptJob): Promise<ScoreResult>;
  draft(ctx: ApplierContext, job: PromptJob): Promise<TextResult>;
  rewrite(ctx: ApplierContext, job: PromptJob, current: string, instruction: RewriteInstruction): Promise<TextResult>;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Pull the first JSON object out of a model reply, tolerating code fences or stray text. */
export function parseScoreJson(text: string): { score: number; reasons: string; redFlags: string } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in model reply: ${text.slice(0, 200)}`);
  const obj = JSON.parse(match[0]) as Record<string, unknown>;
  const score = Number(obj.score);
  if (!Number.isFinite(score)) throw new Error('Model reply has no numeric score');
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).join('\n') : String(v ?? '')).trim();
  return {
    score: clamp(score),
    reasons: list(obj.reasons),
    redFlags: list(obj.red_flags ?? obj.redFlags),
  };
}

/** Strips the wrapping some models add around a plain-text answer. */
export function cleanText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
    .replace(/^```[a-z]*\n?|\n?```$/g, '')
    .trim();
}

/** Shared logic; subclasses only implement one chat call. */
abstract class ChatLlm implements Llm {
  constructor(
    readonly name: string,
    protected readonly model: string,
  ) {}

  protected abstract chat(messages: ChatMessage[], opts: { json: boolean; temperature: number }): Promise<string>;

  private label() {
    return `${this.name}:${this.model}`;
  }

  async score(ctx: ApplierContext, job: PromptJob): Promise<ScoreResult> {
    const text = await this.chat(scoringMessages(ctx, job), { json: true, temperature: 0.2 });
    return { ...parseScoreJson(cleanText(text)), model: this.label() };
  }

  async draft(ctx: ApplierContext, job: PromptJob): Promise<TextResult> {
    const text = cleanText(await this.chat(draftingMessages(ctx, job), { json: false, temperature: 0.7 }));
    if (!text) throw new Error('Empty draft from model');
    return { text, model: this.label() };
  }

  async rewrite(ctx: ApplierContext, job: PromptJob, current: string, instruction: RewriteInstruction): Promise<TextResult> {
    const text = cleanText(
      await this.chat(rewriteMessages(ctx, job, current, instruction), { json: false, temperature: 0.7 }),
    );
    if (!text) throw new Error('Empty rewrite from model');
    return { text, model: this.label() };
  }
}

/** Any OpenAI-compatible chat API: OpenAI, Groq, Ollama. */
export class OpenAICompatibleLlm extends ChatLlm {
  private client: OpenAI;

  constructor(
    name: string,
    model: string,
    opts: { baseURL?: string; apiKey: string },
    private readonly supportsTemperature = true,
    private readonly supportsJsonMode = true,
  ) {
    super(name, model);
    this.client = new OpenAI({ baseURL: opts.baseURL, apiKey: opts.apiKey, maxRetries: 2, timeout: 120_000 });
  }

  protected async chat(messages: ChatMessage[], opts: { json: boolean; temperature: number }): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages,
      ...(this.supportsTemperature ? { temperature: opts.temperature } : {}),
      ...(opts.json && this.supportsJsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    });
    return res.choices[0]?.message?.content ?? '';
  }
}

export class ClaudeLlm extends ChatLlm {
  private client: Anthropic;

  constructor(model: string, apiKey: string) {
    super('claude', model);
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  protected async chat(messages: ChatMessage[], opts: { json: boolean; temperature: number }): Promise<string> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      temperature: opts.temperature,
      system: opts.json ? `${system}\n\nRespond with the JSON object only.` : system,
      messages: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    });
    return res.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('');
  }
}

/**
 * Offline stand-in when no provider is set up, so the app works end to end out of the box.
 * Scores by keyword overlap and writes a plain template. Not meant for real proposals.
 */
export class HeuristicLlm implements Llm {
  readonly name = 'offline';

  async score(ctx: ApplierContext, job: PromptJob): Promise<ScoreResult> {
    const text = `${job.title} ${job.description} ${job.skills.join(' ')}`.toLowerCase();
    const terms = [...ctx.applier.keywords, ...ctx.applier.roles].map((t) => t.toLowerCase()).filter(Boolean);
    const hits = terms.filter((t) => text.includes(t));
    let score = terms.length ? 50 + Math.round((hits.length / terms.length) * 40) : 55;
    if (job.clientPaymentVerified) score += 5;
    if (job.proposalsCount != null && job.proposalsCount > 30) score -= 10;
    return {
      score: clamp(score),
      reasons: hits.length ? `Mentions ${hits.slice(0, 4).join(', ')}.` : 'Few direct matches with your skills.',
      redFlags: job.clientPaymentVerified === false ? 'Client payment method not verified.' : '',
      model: 'offline:heuristic',
    };
  }

  async draft(ctx: ApplierContext, job: PromptJob): Promise<TextResult> {
    const past = ctx.portfolio[0];
    const lines = [
      `Your post about "${job.title}" lines up well with my work${ctx.applier.roles[0] ? ` as a ${ctx.applier.roles[0].toLowerCase()}` : ''}.`,
      past ? `The most relevant thing I've done is ${past.title.toLowerCase()}.` : null,
      ctx.hasVideo ? 'I have attached a short intro video.' : null,
      'What would a great result look like for you in the first two weeks?',
    ].filter(Boolean);
    return { text: lines.join('\n\n'), model: 'offline:template' };
  }

  async rewrite(ctx: ApplierContext, job: PromptJob, current: string): Promise<TextResult> {
    return { text: current, model: 'offline:template' };
  }
}

/** Tries each provider in order; the first that succeeds wins. */
export class FallbackLlm implements Llm {
  readonly name: string;

  constructor(private readonly providers: Llm[]) {
    this.name = providers.map((p) => p.name).join('→');
  }

  private async tryEach<T>(fn: (p: Llm) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (const p of this.providers) {
      try {
        return await fn(p);
      } catch (err) {
        lastError = err;
        console.warn(`[llm] ${p.name} failed: ${(err as Error).message}`);
      }
    }
    throw lastError;
  }

  score(ctx: ApplierContext, job: PromptJob) {
    return this.tryEach((p) => p.score(ctx, job));
  }
  draft(ctx: ApplierContext, job: PromptJob) {
    return this.tryEach((p) => p.draft(ctx, job));
  }
  rewrite(ctx: ApplierContext, job: PromptJob, current: string, instruction: RewriteInstruction) {
    return this.tryEach((p) => p.rewrite(ctx, job, current, instruction));
  }
}

export function buildLlm(c: ProviderCredentials): Llm {
  switch (c.id) {
    case 'claude':
      if (!c.apiKey) throw new Error('Claude needs an API key');
      return new ClaudeLlm(c.model, c.apiKey);
    case 'openai':
      if (!c.apiKey) throw new Error('OpenAI needs an API key');
      // Newer OpenAI models reject a custom temperature, so leave it at the default.
      return new OpenAICompatibleLlm('openai', c.model, { apiKey: c.apiKey }, false);
    case 'groq':
      if (!c.apiKey) throw new Error('Groq needs an API key');
      return new OpenAICompatibleLlm('groq', c.model, { apiKey: c.apiKey, baseURL: 'https://api.groq.com/openai/v1' });
    case 'ollama':
      if (!c.baseUrl) throw new Error('Ollama needs a server address');
      return new OpenAICompatibleLlm('ollama', c.model, { apiKey: 'ollama', baseURL: `${c.baseUrl}/v1` });
  }
}

/**
 * The LLM an applier should use: its chosen provider first (if it is usable),
 * then the rest of the default order. Falls back to the offline heuristic when nothing is set up.
 */
export async function llmFor(preferred: AiProviderId | null): Promise<Llm> {
  const rows = await usableProviders();
  const ordered = preferred ? [...rows.filter((r) => r.id === preferred), ...rows.filter((r) => r.id !== preferred)] : rows;
  const llms = ordered.map((r) => buildLlm(credentialsOf(r)));
  if (llms.length === 0) return new HeuristicLlm();
  return llms.length === 1 ? llms[0] : new FallbackLlm(llms);
}
