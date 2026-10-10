import type { Applier } from '../db/schema.js';
import type { FilterableJob } from './filters.js';

export const PROMPT_VERSION = 'v1';

export interface ApplierContext {
  applier: Pick<
    Applier,
    'name' | 'category' | 'roles' | 'keywords' | 'profileSummary' | 'tone' | 'maxWords' | 'bidRate' | 'drafterInstructions'
  >;
  resumeText: string;
  portfolio: { title: string; description: string }[];
  hasVideo: boolean;
}

export type PromptJob = FilterableJob & { url?: string; postedAt?: Date | null };

function describeBudget(job: PromptJob): string {
  if (job.jobType === 'fixed') return job.budgetMin != null ? `$${job.budgetMin} fixed price` : 'fixed price, budget not stated';
  if (job.budgetMin != null && job.budgetMax != null) return `$${job.budgetMin}–${job.budgetMax}/hr`;
  if (job.budgetMin != null) return `from $${job.budgetMin}/hr`;
  return 'hourly, rate not stated';
}

export function describeJob(job: PromptJob): string {
  const client = [
    job.clientCountry && `based in ${job.clientCountry}`,
    job.clientPaymentVerified === true ? 'payment verified' : job.clientPaymentVerified === false ? 'payment NOT verified' : null,
    job.clientHireRate != null && `${job.clientHireRate}% hire rate`,
    job.clientTotalSpend != null && `$${job.clientTotalSpend} spent on Upwork`,
  ]
    .filter(Boolean)
    .join(', ');

  return [
    `Title: ${job.title}`,
    `Category: ${job.category ?? 'unknown'}`,
    `Budget: ${describeBudget(job)}`,
    `Experience level: ${job.experienceLevel ?? 'not stated'}`,
    `Skills: ${job.skills.join(', ') || 'none listed'}`,
    `Proposals so far: ${job.proposalsCount ?? 'unknown'}`,
    `Client: ${client || 'no details'}`,
    '',
    'Description:',
    job.description,
  ].join('\n');
}

function describeFreelancer(ctx: ApplierContext): string {
  const a = ctx.applier;
  const portfolio = ctx.portfolio.length
    ? ctx.portfolio.map((p, i) => `${i + 1}. ${p.title}${p.description ? ` — ${p.description}` : ''}`).join('\n')
    : 'None provided.';
  return [
    `Target roles: ${a.roles.join(', ') || 'not specified'}`,
    `Category: ${a.category ?? 'any'}`,
    `Key skills: ${a.keywords.join(', ') || 'not specified'}`,
    '',
    'About the freelancer:',
    a.profileSummary || 'Not provided.',
    '',
    'Resume (extract):',
    ctx.resumeText ? ctx.resumeText.slice(0, 4000) : 'Not provided.',
    '',
    'Past work they can mention:',
    portfolio,
  ].join('\n');
}

export function scoringMessages(ctx: ApplierContext, job: PromptJob) {
  return [
    {
      role: 'system' as const,
      content:
        'You screen Upwork job posts for a freelancer. The freelancer can work in any field (admin, writing, design, ' +
        'accounting, customer service, development and so on). Judge fit only from the facts given. ' +
        'Reply with JSON only: {"score": integer 0-100, "reasons": string (one or two short sentences on why it fits), ' +
        '"red_flags": string (short, or empty)}. Score 80+ only when the skills clearly match, the budget is reasonable ' +
        'for the work, and the client looks serious.',
    },
    {
      role: 'user' as const,
      content: `FREELANCER\n${describeFreelancer(ctx)}\n\nJOB POST\n${describeJob(job)}`,
    },
  ];
}

export function draftingMessages(ctx: ApplierContext, job: PromptJob) {
  const a = ctx.applier;
  const rules = [
    `Write in this tone: ${a.tone}.`,
    `Keep it under ${a.maxWords} words.`,
    "Open with the client's problem or goal, not with the freelancer's name or a greeting formula.",
    'Mention at most one or two relevant past projects, only from the list given. Never invent experience, numbers or clients.',
    'End with one specific question for the client.',
    'No headings, no bullet lists, no emoji, no placeholders like [Name].',
    'Avoid stock phrases such as "I hope this finds you well", "I am the perfect fit" or "Dear Hiring Manager".',
    ctx.hasVideo ? 'You may add one short line saying a short intro video is attached.' : null,
    a.bidRate ? `If rate comes up, the freelancer charges $${a.bidRate}/hr.` : null,
    a.drafterInstructions ? `Extra instructions from the freelancer: ${a.drafterInstructions}` : null,
  ].filter(Boolean);

  return [
    {
      role: 'system' as const,
      content:
        'You draft Upwork proposals that the freelancer will read, edit and submit themselves. ' +
        'Write the proposal text only, as the freelancer, in the first person.\n\nRules:\n- ' +
        rules.join('\n- '),
    },
    {
      role: 'user' as const,
      content: `FREELANCER\n${describeFreelancer(ctx)}\n\nJOB POST\n${describeJob(job)}`,
    },
  ];
}
