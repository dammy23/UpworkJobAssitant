import { describe, expect, it } from 'vitest';
import { cleanText, FallbackLlm, HeuristicLlm, parseScoreJson, type Llm } from './llm.js';
import type { ApplierContext, PromptJob } from './prompts.js';
import { mapNode } from './sources/upwork.js';

describe('parseScoreJson', () => {
  it('reads plain JSON and joins list fields with new lines', () => {
    expect(parseScoreJson('{"score": 83.6, "reasons": ["Skills match", "Good budget"], "red_flags": []}')).toEqual({
      score: 84,
      reasons: 'Skills match\nGood budget',
      redFlags: '',
    });
  });

  it('tolerates code fences and clamps the score', () => {
    expect(parseScoreJson('```json\n{"score": 140, "reasons": "ok", "redFlags": "late"}\n```')).toEqual({
      score: 100,
      reasons: 'ok',
      redFlags: 'late',
    });
  });

  it('throws when there is no score', () => {
    expect(() => parseScoreJson('I think it fits')).toThrow();
    expect(() => parseScoreJson('{"reasons": "x"}')).toThrow();
  });
});

describe('cleanText', () => {
  it('removes reasoning blocks and fences', () => {
    expect(cleanText('<think>hmm</think>\n```\nHello there\n```')).toBe('Hello there');
  });
});

const ctx: ApplierContext = {
  applier: {
    name: 'VA',
    category: null,
    roles: ['Virtual assistant'],
    keywords: ['calendar'],
    profileSummary: '',
    tone: 'Warm',
    maxWords: 150,
    bidRate: null,
    drafterInstructions: '',
  },
  resumeText: '',
  portfolio: [],
  hasVideo: false,
};
const job: PromptJob = {
  title: 'Virtual assistant',
  description: 'calendar work',
  category: null,
  skills: [],
  jobType: 'hourly',
  budgetMin: 10,
  budgetMax: 20,
  experienceLevel: null,
  clientCountry: null,
  clientPaymentVerified: true,
  clientHireRate: null,
  clientTotalSpend: null,
  proposalsCount: 3,
};

describe('FallbackLlm', () => {
  it('uses the next provider when one fails', async () => {
    const broken: Llm = {
      name: 'broken',
      score: async () => {
        throw new Error('down');
      },
      draft: async () => {
        throw new Error('down');
      },
      rewrite: async () => {
        throw new Error('down');
      },
    };
    const llm = new FallbackLlm([broken, new HeuristicLlm()]);
    const result = await llm.score(ctx, job);
    expect(result.model).toBe('offline:heuristic');
    expect(result.score).toBeGreaterThan(80);
  });
});

describe('mapNode (Upwork GraphQL)', () => {
  it('maps an hourly job and works out the hire rate', () => {
    const j = mapNode({
      id: '123',
      ciphertext: '~01abc',
      title: 'Bookkeeper',
      description: 'Xero work',
      createdDateTime: '2026-10-10T10:00:00Z',
      experienceLevel: 'INTERMEDIATE',
      totalApplicants: 4,
      skills: [{ name: 'xero', prettyName: 'Xero' }],
      hourlyBudgetMin: { rawValue: '25.0' },
      hourlyBudgetMax: { rawValue: '35' },
      occupations: { category: { prefLabel: 'Accounting & Consulting' } },
      client: { location: { country: 'United Kingdom' }, verificationStatus: 'VERIFIED', totalHires: 9, totalPostedJobs: 10, totalSpent: { rawValue: '22000' } },
    });
    expect(j).toMatchObject({
      upworkId: '123',
      url: 'https://www.upwork.com/jobs/~01abc',
      jobType: 'hourly',
      budgetMin: 25,
      budgetMax: 35,
      experienceLevel: 'intermediate',
      clientHireRate: 90,
      clientPaymentVerified: true,
      skills: ['Xero'],
      category: 'Accounting & Consulting',
    });
  });

  it('maps a fixed-price job', () => {
    const j = mapNode({ id: '9', title: 'Logo', description: '', amount: { rawValue: '300' } });
    expect(j.jobType).toBe('fixed');
    expect(j.budgetMin).toBe(300);
  });
});
