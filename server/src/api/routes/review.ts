import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { appliers, applications, appSettings, jobMatches, jobs, upworkAccounts } from '../../db/schema.js';
import { llmFor } from '../../pipeline/llm.js';
import { jobToPrompt, loadContext } from '../../pipeline/run.js';
import { accountStatus } from '../../services/accounts.js';
import { usableProviders } from '../../services/providers.js';
import { editColumns, queueSubmission, SendError, skipDraft, unqueue } from '../../services/sending.js';
import { HttpError, iso, notFound, parse } from '../http.js';
import { accountRef, applicationViews, draftViews } from '../views.js';

const STATUSES = ['applied', 'viewed', 'replied', 'interview', 'hired', 'declined'] as const;
type AppStatus = (typeof STATUSES)[number];
const OPEN = ['pending_review', 'queued', 'sending', 'submit_failed'] as const;
const EDITABLE = ['pending_review', 'submit_failed'];

const EditsSchema = z.object({
  draft: z.string().max(10000).optional(),
  bidAmount: z.number().int().min(1).max(1_000_000).nullable().optional(),
  duration: z.string().trim().max(100).nullable().optional(),
  answers: z.array(z.object({ question: z.string().max(2000), answer: z.string().max(5000) })).max(20).optional(),
});

async function editableMatch(id: string) {
  const [m] = await db.select().from(jobMatches).where(eq(jobMatches.id, id));
  if (!m) throw notFound('Draft');
  if (m.status === 'queued' || m.status === 'sending') {
    throw new HttpError(409, 'This proposal is approved and waiting to send. Take it out of the queue to change it.');
  }
  if (!EDITABLE.includes(m.status)) throw new HttpError(409, 'This draft has already been handled');
  return m;
}

async function oneDraft(id: string) {
  const [m] = await db.select().from(jobMatches).where(eq(jobMatches.id, id));
  if (!m) throw notFound('Draft');
  return (await draftViews([m]))[0];
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function reviewRoutes(app: FastifyInstance) {
  // ---- Drafts ----
  app.get<{ Querystring: { accountId?: string; sort?: string; state?: string } }>('/drafts', async (req) => {
    let applierIds: string[] | undefined;
    if (req.query.accountId) {
      const rows = await db.select({ id: appliers.id }).from(appliers).where(eq(appliers.upworkAccountId, req.query.accountId));
      applierIds = rows.map((r) => r.id);
      if (applierIds.length === 0) return [];
    }
    const statuses =
      req.query.state === 'ready' ? ['pending_review'] : req.query.state === 'queued' ? ['queued', 'sending'] : req.query.state === 'failed' ? ['submit_failed'] : [...OPEN];
    const where = and(
      inArray(jobMatches.status, statuses as (typeof OPEN)[number][]),
      applierIds ? inArray(jobMatches.applierId, applierIds) : undefined,
    );
    const order = req.query.sort === 'newest' ? [desc(jobMatches.createdAt)] : [desc(jobMatches.score), desc(jobMatches.createdAt)];
    const rows = await db.select().from(jobMatches).where(where).orderBy(...order).limit(300);
    return draftViews(rows);
  });

  app.get<{ Params: { id: string } }>('/drafts/:id', async (req) => oneDraft(req.params.id));

  app.patch<{ Params: { id: string } }>('/drafts/:id', async (req) => {
    const edits = parse(EditsSchema, req.body);
    await editableMatch(req.params.id);
    await db.update(jobMatches).set({ ...editColumns(edits), updatedAt: new Date() }).where(eq(jobMatches.id, req.params.id));
    return oneDraft(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/drafts/:id/rewrite', async (req) => {
    const { instruction } = parse(z.object({ instruction: z.enum(['new', 'shorter', 'warmer', 'specific']) }), req.body);
    const m = await editableMatch(req.params.id);
    if ((await usableProviders()).length === 0) throw new HttpError(400, 'Rewriting needs an AI provider. Connect one in Settings.');
    const [applier] = await db.select().from(appliers).where(eq(appliers.id, m.applierId));
    const [job] = await db.select().from(jobs).where(eq(jobs.id, m.jobId));
    const llm = await llmFor(applier.aiProvider);
    const ctx = await loadContext(applier);
    const prompt = jobToPrompt(job);
    const result = instruction === 'new' ? await llm.draft(ctx, prompt) : await llm.rewrite(ctx, prompt, m.draft ?? '', instruction);
    await db.update(jobMatches).set({ draft: result.text, updatedAt: new Date() }).where(eq(jobMatches.id, m.id));
    return oneDraft(m.id);
  });

  /** Writes (or rewrites) answers to the client's screening questions with AI. */
  app.post<{ Params: { id: string } }>('/drafts/:id/answers/generate', async (req) => {
    const m = await editableMatch(req.params.id);
    const [job] = await db.select().from(jobs).where(eq(jobs.id, m.jobId));
    if (!job.questions.length) return oneDraft(m.id);
    if ((await usableProviders()).length === 0) throw new HttpError(400, 'Writing answers needs an AI provider. Connect one in Settings.');
    const [applier] = await db.select().from(appliers).where(eq(appliers.id, m.applierId));
    const llm = await llmFor(applier.aiProvider);
    const texts = await llm.answer(await loadContext(applier), jobToPrompt(job), job.questions, m.draft ?? '');
    const answers = job.questions.map((question, i) => ({ question, answer: texts[i] ?? '' }));
    await db.update(jobMatches).set({ answers, updatedAt: new Date() }).where(eq(jobMatches.id, m.id));
    return oneDraft(m.id);
  });

  /**
   * Approves one or more drafts for sending. Each item may carry final edits. Every proposal still
   * needs this explicit approval; the queue then sends them one at a time within the account's limits.
   */
  app.post('/drafts/submit', async (req) => {
    const { items } = parse(
      z.object({ items: z.array(EditsSchema.extend({ id: z.string().uuid() })).min(1, 'Choose at least one draft').max(50) }),
      req.body,
    );
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const { id, ...edits } of items) {
      try {
        await queueSubmission(id, 'app', edits);
        results.push({ id, ok: true });
      } catch (err) {
        if (!(err instanceof SendError)) throw err;
        results.push({ id, ok: false, error: err.message });
      }
    }
    const ok = results.filter((r) => r.ok).map((r) => r.id);
    const [{ n: ahead }] = await db.select({ n: sql<number>`count(*)::int` }).from(jobMatches).where(eq(jobMatches.status, 'queued'));
    return { results, drafts: ok.length ? await draftViews(await db.select().from(jobMatches).where(inArray(jobMatches.id, ok))) : [], queued: ahead };
  });

  app.post<{ Params: { id: string } }>('/drafts/:id/unqueue', async (req) => {
    if (!(await unqueue(req.params.id))) throw new HttpError(409, 'It is already sending or sent, so it can’t be taken back.');
    return oneDraft(req.params.id);
  });

  /** Records a proposal the user sent themselves on the Upwork website. */
  app.post<{ Params: { id: string } }>('/drafts/:id/applied', async (req, reply) => {
    const input = parse(
      z.object({
        connectsSpent: z.number().int().min(0).max(1000).nullable(),
        proposalText: z.string().max(10000),
        bidAmount: z.number().int().min(0).max(1_000_000).nullable().optional(),
      }),
      req.body,
    );
    const m = await editableMatch(req.params.id);
    const row = await db.transaction(async (tx) => {
      await tx.update(jobMatches).set({ status: 'applied', draft: input.proposalText, updatedAt: new Date() }).where(eq(jobMatches.id, m.id));
      const [a] = await tx
        .insert(applications)
        .values({
          matchId: m.id,
          applierId: m.applierId,
          jobId: m.jobId,
          proposalText: input.proposalText,
          connectsSpent: input.connectsSpent,
          bidAmount: input.bidAmount ?? m.bidAmount,
          submittedVia: 'manual',
        })
        .returning();
      return a;
    });
    reply.code(201);
    return (await applicationViews([row]))[0];
  });

  app.post<{ Params: { id: string } }>('/drafts/:id/skip', async (req, reply) => {
    const { reason } = parse(z.object({ reason: z.enum(['skip', 'bad_match']).default('skip') }), req.body);
    const [m] = await db.select({ status: jobMatches.status }).from(jobMatches).where(eq(jobMatches.id, req.params.id));
    if (!m) throw notFound('Draft');
    if (!(await skipDraft(req.params.id, reason))) {
      throw new HttpError(409, m.status === 'queued' ? 'Take it out of the queue first.' : 'This draft has already been handled');
    }
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
    const [row] = await db.update(applications).set({ ...input, updatedAt: new Date() }).where(eq(applications.id, req.params.id)).returning();
    if (!row) throw notFound('Application');
    return (await applicationViews([row]))[0];
  });

  app.get('/applications.csv', async (_req, reply) => {
    const rows = await applicationViews(await db.select().from(applications).orderBy(desc(applications.appliedAt)));
    const header = ['Sent', 'Job', 'Account', 'Applier', 'Budget', 'Bid', 'Sent by', 'Status', 'Connects', 'Notes', 'Job link', 'Proposal'];
    const via = { manual: 'You, on Upwork', api: 'The app', simulated: 'Test send' } as const;
    const lines = rows.map((r) =>
      [r.appliedAt.slice(0, 10), r.job.title, r.account.name, r.applier.name, r.job.budgetLabel, r.bidAmount, via[r.submittedVia], r.status, r.connectsSpent, r.notes, r.job.url, r.proposalText]
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
    const byStatus = await db
      .select({ applierId: jobMatches.applierId, status: jobMatches.status, n: sql<number>`count(*)::int` })
      .from(jobMatches)
      .where(inArray(jobMatches.status, [...OPEN]))
      .groupBy(jobMatches.applierId, jobMatches.status);
    const sum = (status: string, applierId?: string) =>
      byStatus.filter((r) => r.status === status && (!applierId || r.applierId === applierId)).reduce((n, r) => n + r.n, 0);

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
    const weekByStatus = Object.fromEntries(STATUSES.map((s) => [s, weekApps.filter((a) => a.status === s).length])) as Record<AppStatus, number>;

    const [{ n: checked }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobMatches)
      .where(gte(jobMatches.createdAt, new Date(Date.now() - 24 * 3600_000)));

    const tg = await db.select().from(appSettings).where(inArray(appSettings.key, ['telegram.botToken', 'telegram.chatId']));
    const accById = new Map(accounts.map((a) => [a.id, a]));

    return {
      pendingDrafts: sum('pending_review'),
      queue: { queued: sum('queued') + sum('sending'), failed: sum('submit_failed') },
      jobsCheckedLast24h: checked,
      topDrafts,
      week: {
        sent: weekApps.length,
        sentByApp: weekApps.filter((a) => a.submittedVia === 'api').length,
        connects: weekApps.reduce((n, a) => n + (a.connectsSpent ?? 0), 0),
        byStatus: weekByStatus,
      },
      appliers: applierRows.map((a) => {
        const acc = accById.get(a.upworkAccountId);
        return {
          id: a.id,
          name: a.name,
          active: a.active,
          lastRunAt: iso(a.lastRunAt),
          pendingDrafts: sum('pending_review', a.id),
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
