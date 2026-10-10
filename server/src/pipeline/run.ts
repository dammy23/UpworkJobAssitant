import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appliers, jobMatches, jobs, materials, type Applier, type Job } from '../db/schema.js';
import { applyFilters, searchTermsFor } from './filters.js';
import { formatBudget } from './format.js';
import { getLlm } from './llm.js';
import { sendDraftAlert } from './notify.js';
import { PROMPT_VERSION, type ApplierContext } from './prompts.js';
import { getJobSource } from './sources/index.js';
import type { NormalizedJob } from './types.js';

export interface RunSummary {
  applierId: string;
  applierName: string;
  fetched: number;
  alreadySeen: number;
  filtered: number;
  belowThreshold: number;
  drafted: number;
  errors: string[];
}

const SEARCH_LIMIT = 50;
const running = new Set<string>();

async function upsertJob(job: NormalizedJob): Promise<Job> {
  const values = {
    upworkId: job.upworkId,
    title: job.title,
    description: job.description,
    url: job.url,
    category: job.category,
    skills: job.skills,
    jobType: job.jobType,
    budgetMin: job.budgetMin,
    budgetMax: job.budgetMax,
    experienceLevel: job.experienceLevel,
    clientCountry: job.clientCountry,
    clientPaymentVerified: job.clientPaymentVerified,
    clientHireRate: job.clientHireRate,
    clientTotalSpend: job.clientTotalSpend,
    proposalsCount: job.proposalsCount,
    postedAt: job.postedAt,
    raw: job.raw,
  };
  const [row] = await db
    .insert(jobs)
    .values(values)
    .onConflictDoUpdate({
      target: jobs.upworkId,
      set: { ...values, fetchedAt: new Date() },
    })
    .returning();
  return row;
}

async function loadContext(applier: Applier): Promise<ApplierContext> {
  const rows = await db.select().from(materials).where(eq(materials.applierId, applier.id));
  const resume = rows.find((m) => m.kind === 'resume');
  return {
    applier,
    resumeText: resume?.description ?? '',
    portfolio: rows
      .filter((m) => m.kind === 'portfolio' && m.useInProposals)
      .map((m) => ({ title: m.title, description: m.description })),
    hasVideo: rows.some((m) => m.kind === 'video'),
  };
}

/** Fetch, filter, score and draft for one applier. Never submits anything to Upwork. */
export async function runApplier(applierId: string): Promise<RunSummary> {
  const [applier] = await db.select().from(appliers).where(eq(appliers.id, applierId));
  if (!applier) throw new Error(`Applier ${applierId} not found`);

  const summary: RunSummary = {
    applierId,
    applierName: applier.name,
    fetched: 0,
    alreadySeen: 0,
    filtered: 0,
    belowThreshold: 0,
    drafted: 0,
    errors: [],
  };

  if (running.has(applierId)) {
    summary.errors.push('A run for this applier is already in progress.');
    return summary;
  }
  running.add(applierId);

  try {
    const source = getJobSource();
    const llm = getLlm();
    const ctx = await loadContext(applier);

    const found = await source.search({
      terms: searchTermsFor(applier),
      category: applier.category,
      limit: SEARCH_LIMIT,
    });
    summary.fetched = found.length;

    for (const nj of found) {
      try {
        const job = await upsertJob(nj);

        const [existing] = await db
          .select({ id: jobMatches.id })
          .from(jobMatches)
          .where(and(eq(jobMatches.applierId, applier.id), eq(jobMatches.jobId, job.id)));
        if (existing) {
          summary.alreadySeen++;
          continue;
        }

        const filter = applyFilters(applier, nj);
        if (!filter.pass) {
          await db.insert(jobMatches).values({
            applierId: applier.id,
            jobId: job.id,
            status: 'filtered',
            filterReason: filter.reason,
          });
          summary.filtered++;
          continue;
        }

        const scored = await llm.score(ctx, nj);
        if (scored.score < applier.scoreThreshold) {
          await db.insert(jobMatches).values({
            applierId: applier.id,
            jobId: job.id,
            status: 'below_threshold',
            score: scored.score,
            reasons: scored.reasons,
            redFlags: scored.redFlags,
            model: scored.model,
            promptVersion: PROMPT_VERSION,
          });
          summary.belowThreshold++;
          continue;
        }

        const draft = await llm.draft(ctx, nj);
        const [match] = await db
          .insert(jobMatches)
          .values({
            applierId: applier.id,
            jobId: job.id,
            status: 'pending_review',
            score: scored.score,
            reasons: scored.reasons,
            redFlags: scored.redFlags,
            draft: draft.text,
            model: `${scored.model} / ${draft.model}`,
            promptVersion: PROMPT_VERSION,
          })
          .returning();
        summary.drafted++;

        if (applier.telegramEnabled) {
          const sent = await sendDraftAlert({
            applierName: applier.name,
            jobTitle: job.title,
            jobUrl: job.url,
            budget: formatBudget(job),
            score: scored.score,
            reasons: scored.reasons,
            draft: draft.text,
          });
          if (sent) {
            await db.update(jobMatches).set({ notifiedAt: new Date() }).where(eq(jobMatches.id, match.id));
          }
        }
      } catch (err) {
        summary.errors.push(`${nj.title}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    summary.errors.push((err as Error).message);
  } finally {
    await db.update(appliers).set({ lastRunAt: new Date() }).where(eq(appliers.id, applierId));
    running.delete(applierId);
  }

  return summary;
}

/** Runs every active applier whose schedule is due (or all active ones when force is set). */
export async function runDueAppliers(opts: { force?: boolean } = {}): Promise<RunSummary[]> {
  const active = await db.select().from(appliers).where(eq(appliers.active, true));
  const now = Date.now();
  const due = active.filter(
    (a) => opts.force || !a.lastRunAt || now - a.lastRunAt.getTime() >= a.scheduleMinutes * 60_000,
  );
  const results: RunSummary[] = [];
  // One at a time keeps us well inside free-tier LLM rate limits.
  for (const a of due) results.push(await runApplier(a.id));
  return results;
}
