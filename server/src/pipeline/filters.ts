import type { Applier } from '../db/schema.js';
import type { NormalizedJob } from './types.js';

export type FilterResult = { pass: true } | { pass: false; reason: string };

/** The applier fields the hard filters look at. */
export type FilterCriteria = Pick<
  Applier,
  | 'category'
  | 'roles'
  | 'keywords'
  | 'excludeKeywords'
  | 'jobType'
  | 'minFixedBudget'
  | 'minHourlyRate'
  | 'experienceLevel'
  | 'clientPaymentVerified'
  | 'clientMinHireRate'
  | 'clientMinTotalSpend'
  | 'maxProposals'
  | 'excludedCountries'
>;

/** The job fields the hard filters look at. */
export type FilterableJob = Pick<
  NormalizedJob,
  | 'title'
  | 'description'
  | 'category'
  | 'skills'
  | 'jobType'
  | 'budgetMin'
  | 'budgetMax'
  | 'experienceLevel'
  | 'clientCountry'
  | 'clientPaymentVerified'
  | 'clientHireRate'
  | 'clientTotalSpend'
  | 'proposalsCount'
>;

const LEVELS = { entry: 0, intermediate: 1, expert: 2 } as const;

const norm = (s: string) => s.trim().toLowerCase();

function containsTerm(haystack: string, term: string): boolean {
  const t = norm(term);
  if (!t) return false;
  // Whole-word-ish match so "Java" doesn't match "JavaScript" and "SEO" doesn't match "seoul".
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(haystack);
}

/**
 * Cheap, deterministic checks that run before any LLM call. Unknown job data
 * (e.g. a client with no hire rate yet) never fails a filter on its own.
 */
export function applyFilters(applier: FilterCriteria, job: FilterableJob): FilterResult {
  const text = `${job.title}\n${job.description}\n${job.skills.join(' ')}`.toLowerCase();

  const excluded = applier.excludeKeywords.find((k) => containsTerm(text, k));
  if (excluded) return { pass: false, reason: `Mentions excluded term "${excluded}"` };

  const includeTerms = [...applier.keywords, ...applier.roles].filter((t) => norm(t));
  if (includeTerms.length > 0 && !includeTerms.some((k) => containsTerm(text, k))) {
    return { pass: false, reason: 'None of the keywords or role titles appear' };
  }

  if (applier.category && job.category && norm(applier.category) !== norm(job.category)) {
    return { pass: false, reason: `Category is ${job.category}` };
  }

  if (applier.jobType !== 'any' && applier.jobType !== job.jobType) {
    return { pass: false, reason: `Job is ${job.jobType} price` };
  }

  if (job.jobType === 'fixed' && applier.minFixedBudget != null && job.budgetMin != null) {
    if (job.budgetMin < applier.minFixedBudget) {
      return { pass: false, reason: `Budget $${job.budgetMin} is under $${applier.minFixedBudget}` };
    }
  }

  if (job.jobType === 'hourly' && applier.minHourlyRate != null) {
    const top = job.budgetMax ?? job.budgetMin;
    if (top != null && top < applier.minHourlyRate) {
      return { pass: false, reason: `Rate up to $${top}/hr is under $${applier.minHourlyRate}/hr` };
    }
  }

  if (applier.experienceLevel !== 'any' && job.experienceLevel) {
    if (LEVELS[job.experienceLevel] < LEVELS[applier.experienceLevel]) {
      return { pass: false, reason: `Job is ${job.experienceLevel} level` };
    }
  }

  if (applier.clientPaymentVerified && job.clientPaymentVerified === false) {
    return { pass: false, reason: 'Client payment method not verified' };
  }

  if (applier.clientMinHireRate != null && job.clientHireRate != null) {
    if (job.clientHireRate < applier.clientMinHireRate) {
      return { pass: false, reason: `Client hire rate ${job.clientHireRate}% is under ${applier.clientMinHireRate}%` };
    }
  }

  if (applier.clientMinTotalSpend != null && job.clientTotalSpend != null) {
    if (job.clientTotalSpend < applier.clientMinTotalSpend) {
      return { pass: false, reason: `Client has spent $${job.clientTotalSpend}, under $${applier.clientMinTotalSpend}` };
    }
  }

  if (applier.maxProposals != null && job.proposalsCount != null) {
    if (job.proposalsCount >= applier.maxProposals) {
      return { pass: false, reason: `Already ${job.proposalsCount} proposals` };
    }
  }

  if (job.clientCountry) {
    const country = norm(job.clientCountry);
    if (applier.excludedCountries.some((c) => norm(c) === country)) {
      return { pass: false, reason: `Client is in ${job.clientCountry}` };
    }
  }

  return { pass: true };
}

/** Search terms for the job source: role titles first, then keywords, de-duplicated. */
export function searchTermsFor(applier: Pick<Applier, 'roles' | 'keywords'>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...applier.roles, ...applier.keywords]) {
    const k = norm(t);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(t.trim());
    }
  }
  return out;
}
