import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { aiProviders, appliers, upworkAccounts, type AiProviderId } from '../../db/schema.js';
import { buildLlm } from '../../pipeline/llm.js';
import { findLatestChatId, sendTelegramMessage } from '../../pipeline/notify.js';
import { FixtureJobSource } from '../../pipeline/sources/fixtures.js';
import { accountColumns, toAccountView } from '../../services/accounts.js';
import {
  credentialsOf,
  isConfigured,
  listOllamaModels,
  listProviderRows,
  PROVIDER_CATALOG,
  recordTest,
  setProviderOrder,
  toProviderView,
  updateProvider,
} from '../../services/providers.js';
import { getTelegram, setTelegram, telegramView } from '../../services/settings.js';
import { HttpError, notFound, parse } from '../http.js';

const ProviderIdSchema = z.enum(['groq', 'claude', 'openai', 'ollama']);

const AccountInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: z.string().trim().max(200).optional(),
  clientId: z.string().max(500).optional(),
  clientSecret: z.string().max(2000).optional(),
  accessToken: z.string().max(5000).optional(),
  refreshToken: z.string().max(5000).optional(),
});

export async function setupRoutes(app: FastifyInstance) {
  // ---- Upwork accounts ----
  app.get('/accounts', async () => {
    const rows = await db.select().from(upworkAccounts).orderBy(asc(upworkAccounts.createdAt));
    return Promise.all(rows.map(toAccountView));
  });

  app.post('/accounts', async (req, reply) => {
    const input = parse(AccountInputSchema, req.body);
    const [row] = await db
      .insert(upworkAccounts)
      .values({ name: input.name, email: input.email ?? '', ...accountColumns(input) })
      .returning();
    reply.code(201);
    return toAccountView(row);
  });

  app.patch<{ Params: { id: string } }>('/accounts/:id', async (req) => {
    const input = parse(AccountInputSchema.partial(), req.body);
    const [row] = await db
      .update(upworkAccounts)
      .set({ ...accountColumns(input), updatedAt: new Date() })
      .where(eq(upworkAccounts.id, req.params.id))
      .returning();
    if (!row) throw notFound('Account');
    return toAccountView(row);
  });

  app.delete<{ Params: { id: string } }>('/accounts/:id', async (req, reply) => {
    const used = await db.select({ id: appliers.id }).from(appliers).where(eq(appliers.upworkAccountId, req.params.id));
    if (used.length) throw new HttpError(409, `This account still has ${used.length} applier(s). Move or delete them first.`);
    const deleted = await db.delete(upworkAccounts).where(eq(upworkAccounts.id, req.params.id)).returning();
    if (!deleted.length) throw notFound('Account');
    reply.code(204);
  });

  // ---- AI providers ----
  app.get('/providers', async () => (await listProviderRows()).map(toProviderView));

  app.patch<{ Params: { id: string } }>('/providers/:id', async (req) => {
    const id = parse(ProviderIdSchema, req.params.id);
    const patch = parse(
      z.object({
        enabled: z.boolean().optional(),
        apiKey: z.string().max(500).optional(),
        baseUrl: z.string().max(500).nullable().optional(),
        model: z.string().max(200).optional(),
      }),
      req.body,
    );
    if (patch.baseUrl) {
      try {
        new URL(patch.baseUrl);
      } catch {
        throw new HttpError(400, 'Server address must be a full URL, like http://localhost:11434');
      }
    }
    return toProviderView(await updateProvider(id, patch));
  });

  app.put('/providers/order', async (req) => {
    const { order } = parse(z.object({ order: z.array(ProviderIdSchema) }), req.body);
    await setProviderOrder(order);
    return (await listProviderRows()).map(toProviderView);
  });

  app.post<{ Params: { id: string } }>('/providers/:id/test', async (req) => {
    const id = parse(ProviderIdSchema, req.params.id) as AiProviderId;
    const [row] = await db.select().from(aiProviders).where(eq(aiProviders.id, id));
    if (!row) throw notFound('Provider');
    if (!isConfigured(row)) {
      const info = PROVIDER_CATALOG[id];
      return { ok: false, message: info.needsKey ? 'Add an API key first.' : 'Add the server address first.' };
    }
    const [job] = await new FixtureJobSource().search({ terms: ['assistant'], category: null, limit: 1 });
    try {
      const llm = buildLlm(credentialsOf(row));
      const result = await llm.score(
        {
          applier: {
            name: 'Test',
            category: 'Admin Support',
            roles: ['Virtual assistant'],
            keywords: ['Calendar management', 'Google Workspace'],
            profileSummary: 'Experienced virtual assistant.',
            tone: 'Direct and specific',
            maxWords: 120,
            bidRate: null,
            drafterInstructions: '',
          },
          resumeText: '',
          portfolio: [],
          hasVideo: false,
        },
        job,
      );
      const message = `Working. ${row.model} scored a sample job ${result.score}.`;
      await recordTest(id, true, message);
      return { ok: true, message };
    } catch (err) {
      const message = `Didn't work: ${(err as Error).message}`;
      await recordTest(id, false, message);
      return { ok: false, message };
    }
  });

  app.get<{ Querystring: { baseUrl?: string } }>('/providers/ollama/models', async (req) => {
    const [row] = await db.select().from(aiProviders).where(eq(aiProviders.id, 'ollama'));
    const baseUrl = req.query.baseUrl || row?.baseUrl || PROVIDER_CATALOG.ollama.defaultBaseUrl!;
    try {
      return { models: await listOllamaModels(baseUrl) };
    } catch (err) {
      throw new HttpError(502, `Couldn't reach Ollama at ${baseUrl}: ${(err as Error).message}`);
    }
  });

  // ---- Telegram ----
  app.get('/settings/telegram', async () => telegramView());

  app.put('/settings/telegram', async (req) => {
    const input = parse(z.object({ botToken: z.string().max(200).optional(), chatId: z.string().max(64).optional() }), req.body);
    await setTelegram(input);
    return telegramView();
  });

  app.post('/settings/telegram/find-chat', async () => {
    const t = await getTelegram();
    if (!t.botToken) return { chatId: null, message: 'Save the bot token first.' };
    try {
      const chatId = await findLatestChatId(t.botToken);
      if (!chatId) return { chatId: null, message: 'No messages yet. Send any message to your bot in Telegram, then try again.' };
      await setTelegram({ chatId });
      return { chatId, message: 'Found your chat and saved it.' };
    } catch (err) {
      return { chatId: null, message: `Telegram said: ${(err as Error).message}` };
    }
  });

  app.post('/settings/telegram/test', async () => {
    try {
      await sendTelegramMessage('Job Assistant is connected. New drafts will arrive here.');
      return { ok: true, message: 'Sent. Check Telegram.' };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });
}
