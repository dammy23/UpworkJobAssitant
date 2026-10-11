import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { appliers, applications, appSettings, jobMatches, jobs, upworkAccounts } from '../../db/schema.js';
import { llmFor } from '../../pipeline/llm.js';
import { jobToPrompt, loadContext } from '../../pipeline/run.js';
import { accountStatus } from '../../services/accounts.js';
import { usableProviders } from '../../services/providers.js';
import { HttpError, iso, notFound, parse } from '../http.js';
import { accountRef, applicationViews, draftViews } from '../views.js';

const STATUSES = ['applied', 'viewed', 'replied', 'interview', 'hired', 'declined'] as const;
type AppStatus = (typeof STATUSES)[number];

async function pendingMatch(id: string) {
  const [m] = await db.select().from(jobMatches).where(eq(jobMatches.id, id));
  if (!m) throw notFound('Draft');
  if (m.status !== 'pending_review') throw new HttpError(409, 'This draft has already been handled');
  return m;
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function reviewRoutes(app: FastifyInstance) {
  // ---- Drafts ----
  app.get<{ Querystring: { accountId?: string; sort?: string } }>('/drafts', async (req) => {
    let applierIds: string[] | undefined;
    if (req.query.accountId) {
      const rows = await db.select({ id: appliers.id }).from(appliers).where(eq(appliers.upworkAccountId, req.query.accountId));
      applierIds = rows.map((r) => r.id);
      if (applierIds.length === 0) return [];
    }
    const where = applierIds
      ? and(eq(jobMatches.status, 'pending_review'), inArray(jobMatches.applierId, applierIds))
      : eq(jobMatches.status, 'pending_review');
    const order = req.query.sort === 'newest' ? [desc(jobMatches.createdAt)] : [desc(jobMatches.score), desc(jobMatches.createdAt)];
    const rows = await db.select().from(jobMatches).where(where).orderBy(...order).limit(200);
    return draftViews(rows);
  });

  app.patch<{ Params: { id: string } }>('/drafts/:id', async (req) => {
    const { draft } = parse(z.object({ draft: z.string().max(10000) }), req.body);
    await pendingMatch(req.params.id);
    const [m] = await db.update(jobMatches).set({ draft, updatedAt: new Date() }).where(eq(jobMatches.id, req.params.id)).returning();
    return (await draftViews([m]))[0];
  });

  app.post<{ Params: { id: string } }>('/drafts/:id/rewrite', async (req) => {
    const { instruction } = parse(z.object({ instruction: z.enum(['new', 'shorter', 'warmer', 'specific']) }), req.body);
    const m = await pendingMatch(req.params.id);
    const [applier] = await db.select().from(appliers).where(eq(appliers.id, m.applierId));
    const [job] = await db.select().from(jobs).where(eq(jobs.id, m.jobId));
    if ((await usableProviders()).length === 0) {
      throw new HttpError(400, 'Rewriting needs an AI provider. Connect one in Settings.');
    }
    const llm = await llmFor(applier.aiProvider);
    const ctx = await loadContext(applier);
    const prompt = jobToPrompt(job);
    const result =
      instruction === 'new' ? await llm.draft(ctx, prompt) : await llm.rewrite(ctx, prompt, m.draft ?? '', instruction);
    const [updated] = await db
      .update(jobMatches)
      .set({ draft: result.text, updatedAt: new Date() })
      .where(eq(jobMatches.id, m.id))
      .returning();
    return (await draftViews([updated]))[0];
  });

  app.post<{ Params: { id: string } }>('/drafts/:id/applied', async (req, reply) => {
    const input = parse(
      z.object({ connectsSpent: z.number().int().min(0).max(1000).nullable(), proposalText: z.string().max(10000) }),
      req.body,
    );
    const m = await pendingMatch(req.params.id);
    const row = await db.transaction(async (tx) => {
      await tx
        .update(jobMatches)
        .set({ status: 'applied', draft: input.proposalText, updatedAt: new Date() })
        .where(eq(jobMatches.id, m.id));
      const [a] = await tx
        .insert(applications)
        .values({
          matchId: m.id,
          applierId: m.applierId,
          jobId: m.jobId,
          proposalText: input.proposalText,
          connectsSpent: input.connectsSpent,
        })
        .returning();
      return a;
    });
    reply.code(201);
    return (await applicationViews([row]))[0];
  });

  app.post<{ Params: { id: string } }>('/drafts/:id/skip', async (req, reply) => {
    const { reason } = parse(z.object({ reason: z.enum(['skip', 'bad_match']).default('skip') }), req.body);
    const m = await pendingMatch(req.params.id);
    await db
      .update(jobMatches)
      .set({ status: reason === 'bad_match' ? 'bad_match' : 'skipped', updatedAt: new Date() })
      .where(eq(jobMatches.id, m.id));
    reply.code(204);
  });

  // ---- Applied jobs ----
  app.get<{ Querystring: { status?: string; accountId?: string; applierId?: string } }>('/applications', async (req) => {
    let rows = await db.select().from(applications).orderBy(desc(applications.appliedAt));
    if (req.query.applierId) rows = rows.filter((r) => r.applierId === req.query.applierId);
    let views = await applicationViews(rows);
    if (req.query.accountId) views = views.filter((v) => v.account.id === req.query.accountId);
    const counts = { all: views.length } as Record<'all' | AppStatus, number>;
    for (const s of STATUSES) counts[s] = views.filter((v) => v.status === s).length;
    const connectsTotal = views.reduce((n, v) => n + (v.connectsSpent ?? 0), 0);
    if (req.query.status && req.query.status !== 'all') views = views.filter((v) => v.status === req.query.status);
    return { items: views, counts, connectsTotal };
  });

  app.patch<{ Params: { id: string } }>('/applications/:id', async (req) => {
    const input = parse(
      z.object({
        status: z.enum(STATUSES).optional(),
        notes: z.string().max(5000).optional(),
        connectsSpent: z.number().int().min(0).max(1000).nullable().optional(),
      }),
      req.body,
    );
    const [row] = await db
      .update(applications)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(applications.id, req.params.id))
      .returning();
    if (!row) throw notFound('Application');
    return (await applicationViews([row]))[0];
  });

  app.get('/applications.csv', async (_req, reply) => {
    const rows = await applicationViews(await db.select().from(applications).orderBy(desc(applications.appliedAt)));
    const header = ['Sent', 'Job', 'Account', 'Applier', 'Budget', 'Status', 'Connects', 'Notes', 'Job link', 'Proposal'];
    const lines = rows.map((r) =>
      [r.appliedAt.slice(0, 10), r.job.title, r.account.name, r.applier.name, r.job.budgetLabel, r.status, r.connectsSpent, r.notes, r.job.url, r.proposalText]
        .map(csvCell)
        .join(','),
    );
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="applied-jobs.csv"');
    return [header.join(','), ...lines].join('\n') + '\n';
  });

  // ---- Home ----
  app.get('/overview', async () => {
    const accounts = await db.select().from(upworkAccounts);
    const applierRows = await db.select().from(appliers);
    const pending = await db
      .select({ applierId: jobMatches.applierId, n: sql<number>`count(*)::int` })
      .from(jobMatches)
      .where(eq(jobMatches.status, 'pending_review'))
      .groupBy(jobMatches.applierId);
    const pendingDrafts = pending.reduce((n, p) => n + p.n, 0);

    const top = await db
      .select()
      .from(jobMatches)
      .where(eq(jobMatches.status, 'pending_review'))
      .orderBy(desc(jobMatches.score), desc(jobMatches.createdAt))
      .limit(5);
    const topDrafts = (await draftViews(top)).map((d) => ({
      id: d.id,
      score: d.score,
      title: d.job.title,
      budgetLabel: d.job.budgetLabel,
      postedAt: d.job.postedAt,
      applier: { id: d.applier.id, name: d.applier.name },
      account: d.account,
    }));

    const since = new Date(Date.now() - 7 * 24 * 3600_000);
    const weekApps = await db.select().from(applications).where(gte(applications.appliedAt, since));
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, weekApps.filter((a) => a.status === s).length])) as Record<AppStatus, number>;

    const [{ n: checked }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobMatches)
      .where(gte(jobMatches.createdAt, new Date(Date.now() - 24 * 3600_000)));

    const tg = await db.select().from(appSettings).where(inArray(appSettings.key, ['telegram.botToken', 'telegram.chatId']));
    const accById = new Map(accounts.map((a) => [a.id, a]));

    return {
      pendingDrafts,
      jobsCheckedLast24h: checked,
      topDrafts,
      week: { sent: weekApps.length, connects: weekApps.reduce((n, a) => n + (a.connectsSpent ?? 0), 0), byStatus },
      appliers: applierRows.map((a) => {
        const acc = accById.get(a.upworkAccountId);
        return {
          id: a.id,
          name: a.name,
          active: a.active,
          lastRunAt: iso(a.lastRunAt),
          pendingDrafts: pending.find((p) => p.applierId === a.id)?.n ?? 0,
          account: acc ? accountRef(acc) : { id: a.upworkAccountId, name: 'Unknown account' },
        };
      }),
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, status: accountStatus(a) })),
      setup: {
        hasAccount: accounts.length > 0,
        hasProvider: (await usableProviders()).length > 0,
        hasApplier: applierRows.length > 0,
        hasTelegram: tg.length === 2,
      },
    };
  });

}
