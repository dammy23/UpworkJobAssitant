import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appliers, applications, jobMatches, jobs, upworkAccounts, type Applier, type Job, type JobMatch, type UpworkAccount } from '../db/schema.js';
import { formatBudget } from '../pipeline/format.js';
import { sendDraftAlert, updateDraftAlert, type DraftAlert } from '../pipeline/notify.js';
import { UpworkRejected } from '../pipeline/sources/upwork.js';
import { clientFor, usageFor } from './accounts.js';

/**
 * Proposals are only ever sent after a person approves each one (in the app or with a tap in
 * Telegram). Approved proposals wait in a queue; this module sends them one at a time per account,
 * with a gap between sends, a daily cap and an optional weekly Connects budget.
 */

export type SendMode = 'api' | 'simulated';
export const sendModeFor = (a: Pick<UpworkAccount, 'accessTokenEnc'>): SendMode => (a.accessTokenEnc ? 'api' : 'simulated');

export interface ProposalEdits {
  draft?: string;
  bidAmount?: number | null;
  duration?: string | null;
  answers?: { question: string; answer: string }[];
}

export class SendError extends Error {}

const EDITABLE = ['pending_review', 'submit_failed'] as const;
const isEditable = (s: JobMatch['status']) => (EDITABLE as readonly string[]).includes(s);

/** Bid and duration suggested for a new draft. */
export function proposalDefaults(applier: Pick<Applier, 'bidRate' | 'defaultDuration'>, job: Pick<Job, 'jobType' | 'budgetMin' | 'budgetMax'>) {
  const bidAmount =
    job.jobType === 'hourly' ? (applier.bidRate ?? job.budgetMax ?? job.budgetMin ?? null) : (job.budgetMin && job.budgetMin > 0 ? job.budgetMin : null);
  return { bidAmount, duration: applier.defaultDuration || null };
}

/** Problems that stop a draft being sent, in plain words. Empty when it's ready. */
export function readinessProblems(m: Pick<JobMatch, 'draft' | 'bidAmount' | 'answers'>, job: Pick<Job, 'questions'>): string[] {
  const out: string[] = [];
  if (!m.draft?.trim()) out.push('The reply is empty.');
  if (!m.bidAmount || m.bidAmount <= 0) out.push('Add your bid.');
  const answered = new Map(m.answers.map((a) => [a.question, a.answer.trim()]));
  const missing = job.questions.filter((q) => !answered.get(q));
  if (missing.length) out.push(`Answer ${missing.length === 1 ? 'the screening question' : `all ${job.questions.length} screening questions`}.`);
  return out;
}

async function load(matchId: string) {
  const [m] = await db.select().from(jobMatches).where(eq(jobMatches.id, matchId));
  if (!m) throw new SendError('That draft no longer exists.');
  const [job] = await db.select().from(jobs).where(eq(jobs.id, m.jobId));
  const [applier] = await db.select().from(appliers).where(eq(appliers.id, m.applierId));
  const [account] = await db.select().from(upworkAccounts).where(eq(upworkAccounts.id, applier.upworkAccountId));
  return { m, job, applier, account };
}

export function editColumns(e: ProposalEdits): Partial<typeof jobMatches.$inferInsert> {
  const set: Partial<typeof jobMatches.$inferInsert> = {};
  if (e.draft !== undefined) set.draft = e.draft;
  if (e.bidAmount !== undefined) set.bidAmount = e.bidAmount;
  if (e.duration !== undefined) set.duration = e.duration;
  if (e.answers !== undefined) set.answers = e.answers;
  return set;
}

/** Approves a draft: saves any last edits, checks it's complete and puts it in the send queue. */
export async function queueSubmission(matchId: string, via: 'app' | 'telegram', edits: ProposalEdits = {}): Promise<JobMatch> {
  const { m, job } = await load(matchId);
  if (m.status === 'queued' || m.status === 'sending') return m; // already approved; a second tap is harmless
  if (m.status === 'applied') throw new SendError('This proposal has already been sent.');
  if (!isEditable(m.status)) throw new SendError('This draft was skipped.');
  const next = { ...m, ...editColumns(edits) } as JobMatch;
  const problems = readinessProblems(next, job);
  if (problems.length) throw new SendError(problems.join(' '));
  const [updated] = await db
    .update(jobMatches)
    .set({ ...editColumns(edits), status: 'queued', queuedAt: new Date(), approvedVia: via, submitError: null, updatedAt: new Date() })
    .where(and(eq(jobMatches.id, matchId), inArray(jobMatches.status, [...EDITABLE])))
    .returning();
  if (!updated) throw new SendError('This draft changed while you were approving it. Refresh and try again.');
  return updated;
}

/** Takes a draft back out of the queue before it's sent. */
export async function unqueue(matchId: string): Promise<boolean> {
  const rows = await db
    .update(jobMatches)
    .set({ status: 'pending_review', queuedAt: null, approvedVia: null, updatedAt: new Date() })
    .where(and(eq(jobMatches.id, matchId), eq(jobMatches.status, 'queued')))
    .returning();
  return rows.length > 0;
}

export async function skipDraft(matchId: string, reason: 'skip' | 'bad_match'): Promise<boolean> {
  const rows = await db
    .update(jobMatches)
    .set({ status: reason === 'bad_match' ? 'bad_match' : 'skipped', updatedAt: new Date() })
    .where(and(eq(jobMatches.id, matchId), inArray(jobMatches.status, [...EDITABLE])))
    .returning();
  return rows.length > 0;
}

/** Why a queued proposal hasn't gone yet, or null if it's next. */
export function waitReason(
  account: Pick<UpworkAccount, 'dailyProposalCap' | 'weeklyConnectsBudget' | 'nextSubmitAt'>,
  usage: { sentToday: number; connectsThisWeek: number },
  connectsNeeded: number | null,
  now = new Date(),
): string | null {
  if (usage.sentToday >= account.dailyProposalCap) {
    return `Daily limit reached (${usage.sentToday} of ${account.dailyProposalCap}). It will send tomorrow.`;
  }
  if (account.weeklyConnectsBudget != null && usage.connectsThisWeek + (connectsNeeded ?? 0) > account.weeklyConnectsBudget) {
    return `This week's Connects budget is used (${usage.connectsThisWeek} of ${account.weeklyConnectsBudget}). It will send on Monday, or raise the budget in Settings.`;
  }
  if (account.nextSubmitAt && account.nextSubmitAt > now) {
    const mins = Math.max(1, Math.ceil((account.nextSubmitAt.getTime() - now.getTime()) / 60_000));
    return `Waiting about ${mins} min between sends.`;
  }
  return null;
}

/** The data a Telegram alert shows for a draft. */
export async function alertFor(matchId: string): Promise<{ alert: DraftAlert; messageId: number | null } | null> {
  const [m] = await db.select().from(jobMatches).where(eq(jobMatches.id, matchId));
  if (!m) return null;
  const { job, applier, account } = await load(matchId);
  const answered = new Map(m.answers.map((a) => [a.question, a.answer.trim()]));
  return {
    messageId: m.telegramMessageId,
    alert: {
      matchId: m.id,
      accountName: account.name,
      applierName: applier.name,
      jobTitle: job.title,
      jobUrl: job.url,
      budget: formatBudget(job),
      score: m.score ?? 0,
      reasons: m.reasons ?? '',
      draft: m.draft ?? '',
      bid: m.bidAmount ? (job.jobType === 'hourly' ? `$${m.bidAmount}/hr` : `$${m.bidAmount.toLocaleString('en-US')}`) : null,
      duration: m.duration,
      questions: job.questions.length,
      unanswered: job.questions.filter((q) => !answered.get(q)).length,
      connects: job.connectsRequired,
    },
  };
}

export async function notifyNewDraft(matchId: string): Promise<void> {
  const a = await alertFor(matchId);
  if (!a) return;
  const messageId = await sendDraftAlert(a.alert);
  if (messageId != null) {
    await db.update(jobMatches).set({ notifiedAt: new Date(), telegramMessageId: messageId }).where(eq(jobMatches.id, matchId));
  }
}

async function updateAlert(matchId: string, status: string, keepButtons = false) {
  const a = await alertFor(matchId);
  if (a?.messageId != null) await updateDraftAlert(a.messageId, a.alert, status, keepButtons);
}

/** Handles a Submit or Skip tap from Telegram. */
export async function handleTelegramTap(action: 'sub' | 'skip', matchId: string): Promise<{ toast: string }> {
  if (action === 'skip') {
    const ok = await skipDraft(matchId, 'skip');
    await updateAlert(matchId, ok ? 'Skipped.' : 'Already handled.');
    return { toast: ok ? 'Skipped' : 'Already handled' };
  }
  try {
    await queueSubmission(matchId, 'telegram');
  } catch (err) {
    if (err instanceof SendError) return { toast: `${err.message} Open the app to finish it.` };
    throw err;
  }
  const { account } = await load(matchId);
  const usage = (await usageFor([account.id])).get(account.id)!;
  const wait = waitReason(account, usage, null);
  const status = wait ? `Approved. ${wait}` : 'Approved. Sending now.';
  await updateAlert(matchId, status);
  return { toast: wait ? `Approved. ${wait}` : 'Approved. Sending now.' };
}

let sendingNow = false;

/**
 * Sends at most one approved proposal per account per call, respecting each account's limits.
 * Call it on a timer. Returns how many it tried.
 */
export async function processQueue(now = new Date()): Promise<number> {
  if (sendingNow) return 0;
  sendingNow = true;
  try {
    const queued = await db.select().from(jobMatches).where(eq(jobMatches.status, 'queued')).orderBy(asc(jobMatches.queuedAt));
    if (!queued.length) return 0;
    const applierRows = await db.select().from(appliers).where(inArray(appliers.id, [...new Set(queued.map((q) => q.applierId))]));
    const accountRows = await db.select().from(upworkAccounts).where(inArray(upworkAccounts.id, [...new Set(applierRows.map((a) => a.upworkAccountId))]));
    const usage = await usageFor(accountRows.map((a) => a.id));
    const jobRows = await db.select().from(jobs).where(inArray(jobs.id, [...new Set(queued.map((q) => q.jobId))]));

    let tried = 0;
    const done = new Set<string>();
    for (const m of queued) {
      const applier = applierRows.find((a) => a.id === m.applierId)!;
      const account = accountRows.find((a) => a.id === applier.upworkAccountId)!;
      if (done.has(account.id)) continue;
      const job = jobRows.find((j) => j.id === m.jobId)!;
      if (waitReason(account, usage.get(account.id)!, job.connectsRequired, now)) {
        done.add(account.id);
        continue;
      }
      done.add(account.id);
      tried++;
      await sendOne(m, job, account);
    }
    return tried;
  } finally {
    sendingNow = false;
  }
}

async function sendOne(m: JobMatch, job: Job, account: UpworkAccount): Promise<void> {
  // Claim it, so a second worker or a double tap can't send it twice.
  const [claimed] = await db
    .update(jobMatches)
    .set({ status: 'sending', submitAttempts: m.submitAttempts + 1, updatedAt: new Date() })
    .where(and(eq(jobMatches.id, m.id), eq(jobMatches.status, 'queued')))
    .returning();
  if (!claimed) return;

  const mode = sendModeFor(account);
  try {
    let proposalId: string | null = null;
    let connects: number | null = null;
    if (mode === 'api') {
      const raw = job.raw as { ciphertext?: string } | null;
      const result = await clientFor(account).submitProposal({
        jobUpworkId: job.upworkId,
        jobCiphertext: raw?.ciphertext ?? null,
        jobType: job.jobType === 'hourly' ? 'hourly' : 'fixed',
        coverLetter: claimed.draft ?? '',
        bidAmount: claimed.bidAmount ?? 0,
        duration: claimed.duration,
        answers: claimed.answers,
      });
      proposalId = result.proposalId;
      connects = result.connectsSpent ?? job.connectsRequired;
    } else {
      // Sample account: nothing goes to Upwork, so the whole flow can be tried before the key is approved.
      await new Promise((r) => setTimeout(r, 300));
      proposalId = `test-${claimed.id.slice(0, 8)}`;
      connects = job.connectsRequired;
    }

    const sentAt = new Date();
    const jitter = Math.round(Math.random() * Math.min(account.minGapSeconds / 2, 120)) * 1000;
    await db.transaction(async (tx) => {
      await tx.update(jobMatches).set({ status: 'applied', submitError: null, updatedAt: sentAt }).where(eq(jobMatches.id, claimed.id));
      await tx.insert(applications).values({
        matchId: claimed.id,
        applierId: claimed.applierId,
        jobId: claimed.jobId,
        proposalText: claimed.draft ?? '',
        connectsSpent: connects,
        bidAmount: claimed.bidAmount,
        submittedVia: mode,
        upworkProposalId: proposalId,
        appliedAt: sentAt,
      });
      await tx
        .update(upworkAccounts)
        .set({ lastSubmitAt: sentAt, nextSubmitAt: new Date(sentAt.getTime() + account.minGapSeconds * 1000 + jitter) })
        .where(eq(upworkAccounts.id, account.id));
    });
    console.log(`[send] ${mode === 'api' ? 'Sent' : 'Test-sent'} "${job.title}" from ${account.name}'s account`);
    await updateAlert(claimed.id, mode === 'api' ? `Sent from ${account.name}'s account.` : `Test send done (${account.name}'s account uses sample jobs, so nothing went to Upwork).`);
  } catch (err) {
    const message = (err as Error).message;
    const final = err instanceof UpworkRejected || claimed.submitAttempts >= 3;
    await db
      .update(jobMatches)
      .set({ status: final ? 'submit_failed' : 'queued', submitError: message.slice(0, 1000), updatedAt: new Date() })
      .where(eq(jobMatches.id, claimed.id));
    // Back off this account for a minute after any failure.
    await db.update(upworkAccounts).set({ nextSubmitAt: new Date(Date.now() + 60_000) }).where(eq(upworkAccounts.id, account.id));
    console.warn(`[send] "${job.title}" ${final ? 'failed' : 'will retry'}: ${message}`);
    if (final) await updateAlert(claimed.id, `Not sent: ${message} Open the app to fix and retry.`);
  }
}

/** Call on start-up. A proposal left mid-send by a crash may or may not have reached Upwork, so ask the user to check rather than resend. */
export async function recoverInterruptedSends(): Promise<void> {
  await db
    .update(jobMatches)
    .set({
      status: 'submit_failed',
      submitError: 'The app stopped while sending this. Check your proposals on Upwork before retrying, so it isn’t sent twice.',
      updatedAt: new Date(),
    })
    .where(eq(jobMatches.status, 'sending'));
}
