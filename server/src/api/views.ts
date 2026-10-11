import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  appliers,
  applications,
  jobMatches,
  jobs,
  materials,
  upworkAccounts,
  type Application,
  type Applier,
  type Job,
  type JobMatch,
  type Material,
  type UpworkAccount,
} from '../db/schema.js';
import { wordCount } from '../lib/extract.js';
import { formatBudget } from '../pipeline/format.js';
import { usageFor } from '../services/accounts.js';
import { readinessProblems, sendModeFor, waitReason } from '../services/sending.js';
import { iso } from './http.js';

export function applierView(a: Applier) {
  return {
    id: a.id,
    name: a.name,
    upworkAccountId: a.upworkAccountId,
    aiProvider: a.aiProvider,
    active: a.active,
    category: a.category,
    roles: a.roles,
    keywords: a.keywords,
    excludeKeywords: a.excludeKeywords,
    jobType: a.jobType,
    minFixedBudget: a.minFixedBudget,
    minHourlyRate: a.minHourlyRate,
    experienceLevel: a.experienceLevel,
    clientPaymentVerified: a.clientPaymentVerified,
    clientMinHireRate: a.clientMinHireRate,
    clientMinTotalSpend: a.clientMinTotalSpend,
    maxProposals: a.maxProposals,
    excludedCountries: a.excludedCountries,
    profileSummary: a.profileSummary,
    tone: a.tone,
    maxWords: a.maxWords,
    bidRate: a.bidRate,
    drafterInstructions: a.drafterInstructions,
    defaultDuration: a.defaultDuration,
    scoreThreshold: a.scoreThreshold,
    scheduleMinutes: a.scheduleMinutes,
    telegramEnabled: a.telegramEnabled,
    lastRunAt: iso(a.lastRunAt),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function materialView(m: Material) {
  return {
    id: m.id,
    kind: m.kind,
    title: m.title,
    description: m.description,
    fileName: m.fileName,
    mimeType: m.mimeType,
    sizeBytes: m.sizeBytes,
    url: m.url,
    useInProposals: m.useInProposals,
    wordCount: m.kind === 'resume' ? wordCount(m.description) : 0,
    createdAt: m.createdAt.toISOString(),
    downloadUrl: m.storedName ? `/api/materials/${m.id}/file` : null,
  };
}

export const accountRef = (a: Pick<UpworkAccount, 'id' | 'name'>) => ({ id: a.id, name: a.name });

export function jobView(j: Job) {
  return {
    id: j.id,
    title: j.title,
    description: j.description,
    url: j.url,
    category: j.category,
    skills: j.skills,
    jobType: j.jobType === 'hourly' ? ('hourly' as const) : ('fixed' as const),
    budgetMin: j.budgetMin,
    budgetMax: j.budgetMax,
    budgetLabel: formatBudget(j),
    experienceLevel: j.experienceLevel,
    clientCountry: j.clientCountry,
    clientPaymentVerified: j.clientPaymentVerified,
    clientHireRate: j.clientHireRate,
    clientTotalSpend: j.clientTotalSpend,
    proposalsCount: j.proposalsCount,
    postedAt: iso(j.postedAt),
    questions: j.questions,
    connectsRequired: j.connectsRequired,
  };
}

const DRAFT_STATE = {
  pending_review: 'ready',
  queued: 'queued',
  sending: 'sending',
  submit_failed: 'failed',
  applied: 'sent',
  skipped: 'skipped',
  bad_match: 'skipped',
  filtered: 'skipped',
  below_threshold: 'skipped',
} as const;

export async function applierSummaries(rows: Applier[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const accounts = await db.select().from(upworkAccounts);
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const mats = await db.select().from(materials).where(inArray(materials.applierId, ids));
  const since = new Date(Date.now() - 7 * 24 * 3600_000);
  const stats = await db
    .select({
      applierId: jobMatches.applierId,
      found: sql<number>`count(*)::int`,
      passed: sql<number>`count(*) filter (where ${jobMatches.status} <> 'filtered')::int`,
      drafted: sql<number>`count(*) filter (where ${jobMatches.draft} is not null)::int`,
    })
    .from(jobMatches)
    .where(and(inArray(jobMatches.applierId, ids), gte(jobMatches.createdAt, since)))
    .groupBy(jobMatches.applierId);
  const pending = await db
    .select({ applierId: jobMatches.applierId, n: sql<number>`count(*)::int` })
    .from(jobMatches)
    .where(and(inArray(jobMatches.applierId, ids), eq(jobMatches.status, 'pending_review')))
    .groupBy(jobMatches.applierId);

  return rows.map((a) => {
    const mine = mats.filter((m) => m.applierId === a.id);
    const st = stats.find((s) => s.applierId === a.id);
    const acc = accById.get(a.upworkAccountId);
    return {
      ...applierView(a),
      account: acc ? accountRef(acc) : { id: a.upworkAccountId, name: 'Unknown account' },
      materials: {
        resume: mine.some((m) => m.kind === 'resume'),
        video: mine.some((m) => m.kind === 'video'),
        portfolioCount: mine.filter((m) => m.kind === 'portfolio').length,
      },
      stats7d: { found: st?.found ?? 0, passed: st?.passed ?? 0, drafted: st?.drafted ?? 0 },
      pendingDrafts: pending.find((p) => p.applierId === a.id)?.n ?? 0,
    };
  });
}

/** Builds Draft views for a set of matches. */
export async function draftViews(matches: JobMatch[]) {
  if (matches.length === 0) return [];
  const jobRows = await db.select().from(jobs).where(inArray(jobs.id, [...new Set(matches.map((m) => m.jobId))]));
  const applierIds = [...new Set(matches.map((m) => m.applierId))];
  const applierRows = await db.select().from(appliers).where(inArray(appliers.id, applierIds));
  const accountRows = await db.select().from(upworkAccounts);
  const mats = await db.select().from(materials).where(inArray(materials.applierId, applierIds));
  const usage = await usageFor(accountRows.map((a) => a.id));

  return matches.flatMap((m) => {
    const job = jobRows.find((j) => j.id === m.jobId);
    const applier = applierRows.find((a) => a.id === m.applierId);
    if (!job || !applier) return [];
    const account = accountRows.find((a) => a.id === applier.upworkAccountId);
    const answered = new Map(m.answers.map((a) => [a.question, a.answer]));
    const state = DRAFT_STATE[m.status];
    return [
      {
        id: m.id,
        state,
        score: m.score ?? 0,
        reasons: m.reasons ?? '',
        redFlags: m.redFlags ?? '',
        draft: m.draft ?? '',
        bidAmount: m.bidAmount,
        duration: m.duration,
        answers: job.questions.map((question) => ({ question, answer: answered.get(question) ?? '' })),
        problems: readinessProblems(m, job),
        sendMode: account ? sendModeFor(account) : ('simulated' as const),
        queuedAt: iso(m.queuedAt),
        approvedVia: m.approvedVia,
        waitReason:
          state === 'queued' && account ? waitReason(account, usage.get(account.id)!, job.connectsRequired) : null,
        submitError: m.submitError,
        createdAt: m.createdAt.toISOString(),
        applier: { id: applier.id, name: applier.name, maxWords: applier.maxWords },
        account: account ? accountRef(account) : { id: applier.upworkAccountId, name: 'Unknown account' },
        job: jobView(job),
        attachments: mats
          .filter((x) => x.applierId === applier.id && (x.kind !== 'portfolio' || (x.useInProposals && (x.storedName || x.url))))
          .map((x) => ({
            id: x.id,
            kind: x.kind,
            title: x.title,
            fileName: x.fileName,
            url: x.url,
            downloadUrl: x.storedName ? `/api/materials/${x.id}/file` : null,
          })),
      },
    ];
  });
}

export async function applicationViews(rows: Application[]) {
  if (rows.length === 0) return [];
  const jobRows = await db.select().from(jobs).where(inArray(jobs.id, [...new Set(rows.map((r) => r.jobId))]));
  const applierRows = await db.select().from(appliers).where(inArray(appliers.id, [...new Set(rows.map((r) => r.applierId))]));
  const accountRows = await db.select().from(upworkAccounts);
  return rows.map((r) => {
    const job = jobRows.find((j) => j.id === r.jobId);
    const applier = applierRows.find((a) => a.id === r.applierId);
    const account = accountRows.find((a) => a.id === applier?.upworkAccountId);
    return {
      id: r.id,
      status: r.status,
      connectsSpent: r.connectsSpent,
      bidAmount: r.bidAmount,
      submittedVia: r.submittedVia,
      notes: r.notes,
      proposalText: r.proposalText,
      appliedAt: r.appliedAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      job: { id: r.jobId, title: job?.title ?? 'Deleted job', url: job?.url ?? '', budgetLabel: job ? formatBudget(job) : '' },
      applier: { id: r.applierId, name: applier?.name ?? 'Deleted applier' },
      account: account ? accountRef(account) : { id: '', name: 'Unknown account' },
    };
  });
}

export type ApplicationView = Awaited<ReturnType<typeof applicationViews>>[number];
export { applications };
