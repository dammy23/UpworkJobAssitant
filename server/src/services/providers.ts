import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { aiProviders, type AiProvider, type AiProviderId } from '../db/schema.js';
import { decryptOrUndefined, encrypt, hint } from '../lib/crypto.js';

export interface ProviderInfo {
  id: AiProviderId;
  name: string;
  needsKey: boolean;
  needsBaseUrl: boolean;
  defaultModel: string;
  defaultBaseUrl: string | null;
  suggestedModels: string[];
}

export const PROVIDER_CATALOG: Record<AiProviderId, ProviderInfo> = {
  groq: {
    id: 'groq',
    name: 'Groq',
    needsKey: true,
    needsBaseUrl: false,
    defaultModel: 'openai/gpt-oss-120b',
    defaultBaseUrl: null,
    suggestedModels: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3-32b'],
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    needsKey: true,
    needsBaseUrl: false,
    defaultModel: 'claude-sonnet-5-5',
    defaultBaseUrl: null,
    suggestedModels: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    needsKey: true,
    needsBaseUrl: false,
    defaultModel: 'gpt-5.5',
    defaultBaseUrl: null,
    suggestedModels: ['gpt-5.5', 'gpt-5.5-instant', 'gpt-5.5-pro'],
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    needsKey: false,
    needsBaseUrl: true,
    defaultModel: 'qwen3:14b',
    defaultBaseUrl: 'http://localhost:11434',
    suggestedModels: ['qwen3:14b', 'llama3.1:8b', 'gemma3:12b'],
  },
};

const ORDER: AiProviderId[] = ['groq', 'claude', 'openai', 'ollama'];

/** Inserts a row for each provider that doesn't have one yet. Safe to call on every start. */
export async function ensureProviders(): Promise<void> {
  const rows = await db.select({ id: aiProviders.id }).from(aiProviders);
  const have = new Set(rows.map((r) => r.id));
  const missing = ORDER.filter((id) => !have.has(id));
  if (missing.length === 0) return;
  await db.insert(aiProviders).values(
    missing.map((id) => ({
      id,
      enabled: false,
      model: PROVIDER_CATALOG[id].defaultModel,
      baseUrl: PROVIDER_CATALOG[id].defaultBaseUrl,
      position: ORDER.indexOf(id) + 1,
    })),
  );
}

export function isConfigured(row: AiProvider): boolean {
  const info = PROVIDER_CATALOG[row.id];
  if (info.needsKey && !row.apiKeyEnc) return false;
  if (info.needsBaseUrl && !row.baseUrl) return false;
  return true;
}

/** A provider row with its secret decrypted, for building clients. */
export interface ProviderCredentials {
  id: AiProviderId;
  name: string;
  apiKey: string | undefined;
  baseUrl: string | null;
  model: string;
}

export function credentialsOf(row: AiProvider): ProviderCredentials {
  return {
    id: row.id,
    name: PROVIDER_CATALOG[row.id].name,
    apiKey: decryptOrUndefined(row.apiKeyEnc),
    baseUrl: row.baseUrl,
    model: row.model,
  };
}

export async function listProviderRows(): Promise<AiProvider[]> {
  return db.select().from(aiProviders).orderBy(asc(aiProviders.position));
}

/** Enabled + configured providers in the default order. */
export async function usableProviders(): Promise<AiProvider[]> {
  return (await listProviderRows()).filter((r) => r.enabled && isConfigured(r));
}

export function toProviderView(row: AiProvider) {
  const info = PROVIDER_CATALOG[row.id];
  let keyHint: string | null = null;
  try {
    keyHint = hint(decryptOrUndefined(row.apiKeyEnc));
  } catch {
    keyHint = 'Saved key could not be read';
  }
  return {
    id: row.id,
    name: info.name,
    enabled: row.enabled,
    configured: isConfigured(row),
    needsKey: info.needsKey,
    needsBaseUrl: info.needsBaseUrl,
    apiKeyHint: keyHint,
    baseUrl: row.baseUrl,
    model: row.model,
    position: row.position,
    suggestedModels: info.suggestedModels,
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
    lastTestOk: row.lastTestOk,
    lastTestMessage: row.lastTestMessage,
  };
}

export async function updateProvider(
  id: AiProviderId,
  patch: { enabled?: boolean; apiKey?: string; baseUrl?: string | null; model?: string },
): Promise<AiProvider> {
  const set: Partial<typeof aiProviders.$inferInsert> = { updatedAt: new Date() };
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.apiKey !== undefined) set.apiKeyEnc = patch.apiKey ? encrypt(patch.apiKey.trim()) : null;
  if (patch.baseUrl !== undefined) set.baseUrl = patch.baseUrl ? patch.baseUrl.trim().replace(/\/+$/, '') : null;
  if (patch.model !== undefined && patch.model.trim()) set.model = patch.model.trim();
  const [row] = await db.update(aiProviders).set(set).where(eq(aiProviders.id, id)).returning();
  return row;
}

export async function setProviderOrder(order: AiProviderId[]): Promise<void> {
  const full = [...new Set([...order, ...ORDER])].filter((id) => ORDER.includes(id));
  await db.transaction(async (tx) => {
    for (const [i, id] of full.entries()) {
      await tx.update(aiProviders).set({ position: i + 1, updatedAt: new Date() }).where(eq(aiProviders.id, id));
    }
  });
}

export async function recordTest(id: AiProviderId, ok: boolean, message: string): Promise<void> {
  await db
    .update(aiProviders)
    .set({ lastTestAt: new Date(), lastTestOk: ok, lastTestMessage: message.slice(0, 500) })
    .where(eq(aiProviders.id, id));
}

/** Lists models installed on an Ollama server. */
export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Ollama replied ${res.status}`);
  const body = (await res.json()) as { models?: { name: string }[] };
  return (body.models ?? []).map((m) => m.name);
}
