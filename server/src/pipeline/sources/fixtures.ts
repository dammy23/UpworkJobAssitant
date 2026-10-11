import type { JobSearch, JobSource, NormalizedJob } from '../types.js';

/**
 * Sample jobs across many kinds of role, so the whole pipeline and UI can be
 * tried before an Upwork API key is approved. Set JOB_SOURCE=upwork to use real jobs.
 */
type Fixture = Omit<NormalizedJob, 'upworkId' | 'url' | 'postedAt' | 'raw'> & {
  id: string;
  postedMinutesAgo: number;
};

const FIXTURES: Fixture[] = [
  {
    id: 'fx-001',
    questions: ["Which calendar and email tools have you used most?", "When would you be available to start?"],
    connectsRequired: 12,
    title: 'Executive assistant for a busy founder (10 hrs/week)',
    description:
      'Looking for an organised executive assistant to manage my calendar, triage my inbox and book travel. You will work in Google Workspace and send a short end-of-day summary. Long-term role, UK hours preferred.',
    category: 'Admin Support',
    skills: ['Calendar management', 'Email management', 'Google Workspace', 'Travel planning'],
    jobType: 'hourly',
    budgetMin: 18,
    budgetMax: 25,
    experienceLevel: 'intermediate',
    clientCountry: 'United Kingdom',
    clientPaymentVerified: true,
    clientHireRate: 85,
    clientTotalSpend: 40000,
    proposalsCount: 8,
    postedMinutesAgo: 55,
  },
  {
    id: 'fx-002',
    questions: [],
    connectsRequired: 8,
    title: 'Data entry and CRM clean-up (HubSpot)',
    description:
      'We need someone careful to de-duplicate around 4,000 contacts in HubSpot, fix company associations and fill missing fields from LinkedIn. Accuracy matters more than speed.',
    category: 'Admin Support',
    skills: ['Data entry', 'HubSpot', 'CRM'],
    jobType: 'fixed',
    budgetMin: 300,
    budgetMax: null,
    experienceLevel: 'entry',
    clientCountry: 'United States',
    clientPaymentVerified: true,
    clientHireRate: 70,
    clientTotalSpend: 12000,
    proposalsCount: 22,
    postedMinutesAgo: 120,
  },
  {
    id: 'fx-003',
    questions: ["Please share links to two published samples.", "How do you research UK personal finance topics?"],
    connectsRequired: 10,
    title: 'Weekly SEO blog posts for a fintech startup',
    description:
      'Four 1,200-word blog posts a month on personal finance topics. You will get a keyword brief for each post. Must write naturally for UK readers. Please share two published samples.',
    category: 'Writing',
    skills: ['Blog writing', 'SEO', 'Fintech'],
    jobType: 'fixed',
    budgetMin: 600,
    budgetMax: null,
    experienceLevel: 'intermediate',
    clientCountry: 'United Kingdom',
    clientPaymentVerified: true,
    clientHireRate: 64,
    clientTotalSpend: 9000,
    proposalsCount: 14,
    postedMinutesAgo: 30,
  },
  {
    id: 'fx-004',
    questions: [],
    connectsRequired: 6,
    title: 'Copywriter for product launch emails',
    description:
      'Write a five-email launch sequence for our new skincare line. Brand voice is warm and confident. Commission only for the first month, then paid.',
    category: 'Writing',
    skills: ['Copywriting', 'Email marketing'],
    jobType: 'fixed',
    budgetMin: 0,
    budgetMax: null,
    experienceLevel: 'intermediate',
    clientCountry: 'United States',
    clientPaymentVerified: false,
    clientHireRate: null,
    clientTotalSpend: 0,
    proposalsCount: 31,
    postedMinutesAgo: 200,
  },
  {
    id: 'fx-005',
    questions: ["Which version of Xero have you worked with, and for how long?"],
    connectsRequired: 12,
    title: 'Bookkeeper for a small e-commerce shop (Xero)',
    description:
      'Monthly bookkeeping in Xero: reconcile bank feeds, categorise Shopify payouts, and prepare VAT returns for review. About 6 hours a month, ongoing.',
    category: 'Accounting & Consulting',
    skills: ['Bookkeeping', 'Xero', 'VAT'],
    jobType: 'hourly',
    budgetMin: 25,
    budgetMax: 35,
    experienceLevel: 'intermediate',
    clientCountry: 'United Kingdom',
    clientPaymentVerified: true,
    clientHireRate: 90,
    clientTotalSpend: 22000,
    proposalsCount: 6,
    postedMinutesAgo: 75,
  },
  {
    id: 'fx-006',
    questions: [],
    connectsRequired: 8,
    title: 'Customer support agent for live chat (evenings)',
    description:
      'Answer customer questions on Intercom live chat, 6pm–10pm UK time, five evenings a week. Experience with Shopify order issues is a plus.',
    category: 'Customer Service',
    skills: ['Customer support', 'Intercom', 'Live chat'],
    jobType: 'hourly',
    budgetMin: 12,
    budgetMax: 16,
    experienceLevel: 'entry',
    clientCountry: 'United Kingdom',
    clientPaymentVerified: true,
    clientHireRate: 78,
    clientTotalSpend: 15000,
    proposalsCount: 40,
    postedMinutesAgo: 15,
  },
  {
    id: 'fx-007',
    questions: [],
    connectsRequired: 10,
    title: 'Graphic designer for social media templates (Canva)',
    description:
      'Create 20 editable Canva templates for Instagram posts and stories in our brand colours. Must deliver source files.',
    category: 'Design & Creative',
    skills: ['Graphic design', 'Canva', 'Social media'],
    jobType: 'fixed',
    budgetMin: 400,
    budgetMax: null,
    experienceLevel: 'intermediate',
    clientCountry: 'Canada',
    clientPaymentVerified: true,
    clientHireRate: 55,
    clientTotalSpend: 3000,
    proposalsCount: 18,
    postedMinutesAgo: 95,
  },
  {
    id: 'fx-008',
    questions: [],
    connectsRequired: 14,
    title: 'French to English translation of a 30-page user manual',
    description:
      'Translate a technical user manual for kitchen appliances from French into UK English. Native English speaker required. Deadline in 10 days.',
    category: 'Translation',
    skills: ['French', 'Translation', 'Technical writing'],
    jobType: 'fixed',
    budgetMin: 900,
    budgetMax: null,
    experienceLevel: 'expert',
    clientCountry: 'France',
    clientPaymentVerified: true,
    clientHireRate: 80,
    clientTotalSpend: 18000,
    proposalsCount: 5,
    postedMinutesAgo: 240,
  },
  {
    id: 'fx-009',
    questions: ["Describe a queue migration you have done in Laravel."],
    connectsRequired: 16,
    title: 'Move a Laravel monolith to queued background jobs',
    description:
      'Our Laravel 11 app does heavy work in the request cycle (emails, PDF generation, third-party API calls). We want it moved onto Redis-backed queues with Horizon, with safe retries.',
    category: 'Web, Mobile & Software Dev',
    skills: ['Laravel', 'PHP', 'Redis', 'Queues'],
    jobType: 'fixed',
    budgetMin: 3000,
    budgetMax: null,
    experienceLevel: 'expert',
    clientCountry: 'United States',
    clientPaymentVerified: true,
    clientHireRate: 72,
    clientTotalSpend: 18000,
    proposalsCount: 9,
    postedMinutesAgo: 22,
  },
  {
    id: 'fx-010',
    questions: [],
    connectsRequired: 14,
    title: 'Build a REST API for a logistics booking app',
    description:
      'Laravel REST API with token auth, booking rules, and tests. A mobile team will consume it. Booking rules are partly documented.',
    category: 'Web, Mobile & Software Dev',
    skills: ['Laravel', 'REST API', 'PHP'],
    jobType: 'fixed',
    budgetMin: 1500,
    budgetMax: null,
    experienceLevel: 'intermediate',
    clientCountry: 'United Kingdom',
    clientPaymentVerified: true,
    clientHireRate: 60,
    clientTotalSpend: 5000,
    proposalsCount: 12,
    postedMinutesAgo: 180,
  },
  {
    id: 'fx-011',
    questions: [],
    connectsRequired: 8,
    title: 'WordPress site speed fixes',
    description: 'Our WordPress site loads slowly. Need caching, image optimisation and plugin clean-up.',
    category: 'Web, Mobile & Software Dev',
    skills: ['WordPress', 'PHP', 'Performance'],
    jobType: 'fixed',
    budgetMin: 250,
    budgetMax: null,
    experienceLevel: 'intermediate',
    clientCountry: 'Australia',
    clientPaymentVerified: true,
    clientHireRate: 50,
    clientTotalSpend: 2000,
    proposalsCount: 27,
    postedMinutesAgo: 60,
  },
  {
    id: 'fx-012',
    questions: [],
    connectsRequired: 8,
    title: 'Social media manager for a local bakery',
    description:
      'Plan and post content on Instagram and Facebook three times a week, reply to comments, and send a monthly report. Photos are provided.',
    category: 'Sales & Marketing',
    skills: ['Social media marketing', 'Instagram', 'Content planning'],
    jobType: 'hourly',
    budgetMin: 15,
    budgetMax: 20,
    experienceLevel: 'entry',
    clientCountry: 'United Kingdom',
    clientPaymentVerified: true,
    clientHireRate: null,
    clientTotalSpend: 0,
    proposalsCount: 11,
    postedMinutesAgo: 45,
  },
];

function matches(f: Fixture, query: JobSearch): boolean {
  if (query.category && f.category && query.category.toLowerCase() === f.category.toLowerCase()) return true;
  if (query.terms.length === 0) return !query.category;
  const text = `${f.title} ${f.description} ${f.skills.join(' ')}`.toLowerCase();
  return query.terms.some((t) => text.includes(t.toLowerCase()));
}

export class FixtureJobSource implements JobSource {
  readonly name = 'fixtures';

  async search(query: JobSearch): Promise<NormalizedJob[]> {
    const now = Date.now();
    return FIXTURES.filter((f) => matches(f, query))
      .slice(0, query.limit)
      .map(({ id, postedMinutesAgo, ...rest }) => ({
        ...rest,
        upworkId: id,
        url: `https://www.upwork.com/jobs/~${id}`,
        postedAt: new Date(now - postedMinutesAgo * 60_000),
        raw: { fixture: true, id },
      }));
  }
}
