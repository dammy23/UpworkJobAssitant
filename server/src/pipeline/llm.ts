import OpenAI from 'openai';
import { config } from '../config.js';
import { draftingMessages, scoringMessages, type ApplierContext, type PromptJob } from './prompts.js';

export interface ScoreResult {
  score: number;
  reasons: string;
  redFlags: string;
  model: string;
}

export interface DraftResult {
  text: string;
  model: string;
}

/** Scores and drafts. Swap providers by swapping implementations. */
export interface Llm {
  readonly name: string;
  score(ctx: ApplierContext, job: PromptJob): Promise<ScoreResult>;
  draft(ctx: ApplierContext, job: PromptJob): Promise<DraftResult>;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Pull the first JSON object out of a model reply, tolerating code fences or stray text. */
export function parseScoreJson(text: string): { score: number; reasons: string; redFlags: string } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in model reply: ${text.slice(0, 200)}`);
  const obj = JSON.parse(match[0]) as Record<string, unknown>;
  const score = Number(obj.score);
  if (!Number.isFinite(score)) throw new Error('Model reply has no numeric score');
  return {
    score: clamp(score),
    reasons: String(obj.reasons ?? '').trim(),
    redFlags: String(obj.red_flags ?? obj.redFlags ?? '').trim(),
  };
}

/** Any OpenAI-compatible chat API: Groq, OpenRouter, a local Ollama, etc. */
export class OpenAICompatibleLlm implements Llm {
  private client: OpenAI;

  constructor(
    readonly name: string,
    baseURL: string,
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ baseURL, apiKey, maxRetries: 3, timeout: 60_000 });
  }

  async score(ctx: ApplierContext, job: PromptJob): Promise<ScoreResult> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: scoringMessages(ctx, job),
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
    const text = res.choices[0]?.message?.content ?? '';
    return { ...parseScoreJson(text), model: `${this.name}:${this.model}` };
  }

  async draft(ctx: ApplierContext, job: PromptJob): Promise<DraftResult> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: draftingMessages(ctx, job),
      temperature: 0.7,
    });
    const text = (res.choices[0]?.message?.content ?? '').trim();
    if (!text) throw new Error('Empty draft from model');
    return { text, model: `${this.name}:${this.model}` };
  }
}

/**
 * Offline stand-in used when no API key is set, so the app runs end to end out of the box.
 * Scores by keyword overlap and writes a plain template draft. Not meant for real use.
 */
export class HeuristicLlm implements Llm {
  readonly name = 'offline';

  async score(ctx: ApplierContext, job: PromptJob): Promise<ScoreResult> {
    const text = `${job.title} ${job.description} ${job.skills.join(' ')}`.toLowerCase();
    const terms = [...ctx.applier.keywords, ...ctx.applier.roles].map((t) => t.toLowerCase()).filter(Boolean);
    const hits = terms.filter((t) => text.includes(t));
    let score = terms.length ? 45 + Math.round((hits.length / terms.length) * 45) : 55;
    if (job.clientPaymentVerified) score += 5;
    if (job.proposalsCount != null && job.proposalsCount > 30) score -= 10;
    return {
      score: clamp(score),
      reasons: hits.length ? `Matches ${hits.join(', ')}.` : 'Few direct keyword matches.',
      redFlags: job.clientPaymentVerified === false ? 'Client payment not verified.' : '',
      model: 'offline:heuristic',
    };
  }

  async draft(ctx: ApplierContext, job: PromptJob): Promise<DraftResult> {
    const past = ctx.portfolio[0];
    const lines = [
      `Hi, I read your post about "${job.title}" and it lines up well with my work as ${ctx.applier.roles[0] ?? 'a freelancer'}.`,
      past ? `Most relevant: ${past.title}.` : null,
      ctx.hasVideo ? 'I have attached a short intro video.' : null,
      'What would a great result look like for you in the first two weeks?',
    ].filter(Boolean);
    return {
      text: `${lines.join('\n\n')}\n\n(Offline draft: add a GROQ_API_KEY for real proposals.)`,
      model: 'offline:template',
    };
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
}

let llm: Llm | undefined;

export function getLlm(): Llm {
  if (llm) return llm;
  const providers: Llm[] = [];
  if (config.GROQ_API_KEY) {
    providers.push(new OpenAICompatibleLlm('groq', 'https://api.groq.com/openai/v1', config.GROQ_API_KEY, config.GROQ_MODEL));
  }
  if (config.FALLBACK_LLM_BASE_URL && config.FALLBACK_LLM_API_KEY && config.FALLBACK_LLM_MODEL) {
    providers.push(
      new OpenAICompatibleLlm('fallback', config.FALLBACK_LLM_BASE_URL, config.FALLBACK_LLM_API_KEY, config.FALLBACK_LLM_MODEL),
    );
  }
  if (providers.length === 0) {
    console.warn('[llm] No LLM key set: using the offline heuristic scorer and template drafts.');
    providers.push(new HeuristicLlm());
  }
  llm = providers.length === 1 ? providers[0] : new FallbackLlm(providers);
  return llm;
}
