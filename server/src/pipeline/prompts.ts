import type { Applier } from '../db/schema.js';
import type { FilterableJob } from './filters.js';

export const PROMPT_VERSION = 'v2';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type RewriteInstruction = 'new' | 'shorter' | 'warmer' | 'specific';

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

export function scoringMessages(ctx: ApplierContext, job: PromptJob): ChatMessage[] {
  return [
    {
      role: 'system' as const,
      content:
        'You screen Upwork job posts for a freelancer. The freelancer can work in any field (admin, writing, design, ' +
        'accounting, customer service, development and so on). Judge fit only from the facts given. ' +
        'Reply with JSON only: {"score": integer 0-100, "reasons": array of 1-3 short sentences on why it fits, ' +
        '"red_flags": array of 0-2 short sentences on concerns}. Score 80+ only when the skills clearly match, the budget ' +
        'is reasonable for the work, and the client looks serious. Score under 50 when the core skills are missing.',
    },
    {
      role: 'user' as const,
      content: `FREELANCER\n${describeFreelancer(ctx)}\n\nJOB POST\n${describeJob(job)}`,
    },
  ];
}

function draftRules(ctx: ApplierContext): string[] {
  const a = ctx.applier;
  return [
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
  ].filter((r): r is string => Boolean(r));
}

const DRAFTER =
  'You draft Upwork proposals that the freelancer will read, edit and submit themselves. ' +
  'Write the proposal text only, as the freelancer, in the first person. Output nothing else.';

export function draftingMessages(ctx: ApplierContext, job: PromptJob): ChatMessage[] {
  return [
    { role: 'system', content: `${DRAFTER}\n\nRules:\n- ${draftRules(ctx).join('\n- ')}` },
    { role: 'user', content: `FREELANCER\n${describeFreelancer(ctx)}\n\nJOB POST\n${describeJob(job)}` },
  ];
}

export function answerMessages(ctx: ApplierContext, job: PromptJob, questions: string[], coverLetter: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You answer an Upwork client’s screening questions for a freelancer, in the first person, as the freelancer. ' +
        'Use only facts from the freelancer’s profile, resume and past work; never invent experience, links or numbers. ' +
        'If a question asks for something you do not have (for example a link), say briefly what the freelancer can share on request. ' +
        'Keep each answer to one to three sentences. Reply with JSON only: {"answers": [string, ...]} in the same order as the questions.',
    },
    {
      role: 'user',
      content:
        `FREELANCER\n${describeFreelancer(ctx)}\n\nJOB POST\n${describeJob(job)}\n\nCOVER LETTER ALREADY WRITTEN\n${coverLetter}\n\n` +
        `QUESTIONS\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
    },
  ];
}

const REWRITE_ASKS: Record<RewriteInstruction, string> = {
  new: 'Write a fresh version with a different opening and a different past project if one fits.',
  shorter: 'Make it about half as long. Keep the opening idea and the closing question.',
  warmer: 'Make it warmer and more personal, without becoming informal or gushing.',
  specific: 'Make it more specific to this job: name the client’s tools, tasks or goals from the post.',
};

export function rewriteMessages(
  ctx: ApplierContext,
  job: PromptJob,
  current: string,
  instruction: RewriteInstruction,
): ChatMessage[] {
  return [
    { role: 'system', content: `${DRAFTER}\n\nRules:\n- ${draftRules(ctx).join('\n- ')}` },
    {
      role: 'user',
      content:
        `FREELANCER\n${describeFreelancer(ctx)}\n\nJOB POST\n${describeJob(job)}\n\n` +
        `CURRENT DRAFT\n${current}\n\nTASK\n${REWRITE_ASKS[instruction]}`,
    },
  ];
}
