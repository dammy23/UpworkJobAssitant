import type { Job } from '../db/schema.js';

export function formatBudget(job: Pick<Job, 'jobType' | 'budgetMin' | 'budgetMax'>): string {
  const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
  if (job.jobType === 'fixed') return job.budgetMin != null ? `${usd(job.budgetMin)} fixed` : 'Fixed price';
  if (job.budgetMin != null && job.budgetMax != null) return `${usd(job.budgetMin)}–${job.budgetMax}/hr`;
  if (job.budgetMin != null) return `${usd(job.budgetMin)}+/hr`;
  return 'Hourly';
}
