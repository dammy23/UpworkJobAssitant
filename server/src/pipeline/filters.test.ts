import { describe, expect, it } from 'vitest';
import { applyFilters, searchTermsFor, type FilterableJob, type FilterCriteria } from './filters.js';

const criteria = (over: Partial<FilterCriteria> = {}): FilterCriteria => ({
  category: null,
  roles: [],
  keywords: [],
  excludeKeywords: [],
  jobType: 'any',
  minFixedBudget: null,
  minHourlyRate: null,
  experienceLevel: 'any',
  clientPaymentVerified: false,
  clientMinHireRate: null,
  clientMinTotalSpend: null,
  maxProposals: null,
  excludedCountries: [],
  ...over,
});

const job = (over: Partial<FilterableJob> = {}): FilterableJob => ({
  title: 'Executive assistant for a founder',
  description: 'Manage my calendar and inbox in Google Workspace.',
  category: 'Admin Support',
  skills: ['Calendar management'],
  jobType: 'hourly',
  budgetMin: 18,
  budgetMax: 25,
  experienceLevel: 'intermediate',
  clientCountry: 'United Kingdom',
  clientPaymentVerified: true,
  clientHireRate: 80,
  clientTotalSpend: 5000,
  proposalsCount: 8,
  ...over,
});

describe('applyFilters', () => {
  it('passes when nothing is restricted', () => {
    expect(applyFilters(criteria(), job())).toEqual({ pass: true });
  });

  it('matches role titles or keywords as whole words', () => {
    expect(applyFilters(criteria({ keywords: ['Google Workspace'] }), job()).pass).toBe(true);
    expect(applyFilters(criteria({ roles: ['Executive assistant'] }), job()).pass).toBe(true);
    expect(applyFilters(criteria({ keywords: ['Java'] }), job({ description: 'JavaScript only' })).pass).toBe(false);
  });

  it('rejects excluded terms with the reason', () => {
    const r = applyFilters(criteria({ excludeKeywords: ['commission only'] }), job({ description: 'Commission only for now' }));
    expect(r).toEqual({ pass: false, reason: 'Mentions excluded term "commission only"' });
  });

  it('checks category, job type and budget', () => {
    expect(applyFilters(criteria({ category: 'Writing' }), job()).pass).toBe(false);
    expect(applyFilters(criteria({ jobType: 'fixed' }), job()).pass).toBe(false);
    expect(applyFilters(criteria({ minHourlyRate: 30 }), job()).pass).toBe(false);
    expect(applyFilters(criteria({ minHourlyRate: 25 }), job()).pass).toBe(true);
    expect(applyFilters(criteria({ minFixedBudget: 500 }), job({ jobType: 'fixed', budgetMin: 300, budgetMax: null })).pass).toBe(false);
  });

  it('treats experience level as a minimum', () => {
    expect(applyFilters(criteria({ experienceLevel: 'expert' }), job()).pass).toBe(false);
    expect(applyFilters(criteria({ experienceLevel: 'entry' }), job()).pass).toBe(true);
  });

  it('checks client quality but never fails on unknown data', () => {
    expect(applyFilters(criteria({ clientPaymentVerified: true }), job({ clientPaymentVerified: false })).pass).toBe(false);
    expect(applyFilters(criteria({ clientPaymentVerified: true }), job({ clientPaymentVerified: null })).pass).toBe(true);
    expect(applyFilters(criteria({ clientMinHireRate: 90 }), job()).pass).toBe(false);
    expect(applyFilters(criteria({ clientMinHireRate: 90 }), job({ clientHireRate: null })).pass).toBe(true);
    expect(applyFilters(criteria({ clientMinTotalSpend: 10000 }), job()).pass).toBe(false);
    expect(applyFilters(criteria({ maxProposals: 8 }), job()).pass).toBe(false);
    expect(applyFilters(criteria({ excludedCountries: ['united kingdom'] }), job()).pass).toBe(false);
  });
});

describe('searchTermsFor', () => {
  it('puts roles first and removes duplicates', () => {
    expect(searchTermsFor({ roles: ['Writer', ' SEO '], keywords: ['seo', 'Blog'] })).toEqual(['Writer', 'SEO', 'Blog']);
  });
});
