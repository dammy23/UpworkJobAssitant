import type { JobSearch, JobSource, NormalizedJob } from '../types.js';

/**
 * Read-only job search through Upwork's official GraphQL API.
 *
 * This only SEARCHES jobs. It never submits proposals or sends messages: that
 * stays a manual step on Upwork, as Upwork's terms require.
 *
 * The query below follows Upwork's marketplace job search. Field names can change,
 * so check it in the API explorer once your key is approved
 * (https://www.upwork.com/developer/documentation/graphql/api/docs/index.html)
 * and adjust JOB_SEARCH_QUERY and mapNode() if needed. Everything Upwork-specific
 * lives in this file.
 */

const GRAPHQL_URL = 'https://api.upwork.com/graphql';
const TOKEN_URL = 'https://www.upwork.com/api/v3/oauth2/token';

export const JOB_SEARCH_QUERY = /* GraphQL */ `
  query JobSearch($filter: MarketplaceJobPostingsSearchFilter, $sort: [MarketplaceJobPostingSearchSortAttribute]) {
    marketplaceJobPostingsSearch(
      marketPlaceJobFilter: $filter
      searchType: USER_JOBS_SEARCH
      sortAttributes: $sort
    ) {
      edges {
        node {
          id
          ciphertext
          title
          description
          createdDateTime
          experienceLevel
          totalApplicants
          skills { name prettyName }
          amount { rawValue currency }
          hourlyBudgetMin { rawValue currency }
          hourlyBudgetMax { rawValue currency }
          occupations { category { prefLabel } }
          client {
            location { country }
            verificationStatus
            totalHires
            totalPostedJobs
            totalSpent { rawValue currency }
          }
        }
      }
    }
  }
`;

export interface UpworkCredentials {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
}

type Money = { rawValue?: string | number | null } | null | undefined;

const num = (m: Money): number | null => {
  if (!m || m.rawValue == null || m.rawValue === '') return null;
  const n = Number(m.rawValue);
  return Number.isFinite(n) ? Math.round(n) : null;
};

function mapExperience(v: unknown): NormalizedJob['experienceLevel'] {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('entry')) return 'entry';
  if (s.includes('intermediate')) return 'intermediate';
  if (s.includes('expert')) return 'expert';
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapNode(node: any): NormalizedJob {
  const hourlyMin = num(node.hourlyBudgetMin);
  const hourlyMax = num(node.hourlyBudgetMax);
  const fixed = num(node.amount);
  const isHourly = hourlyMin != null || hourlyMax != null || !fixed;
  const hires = Number(node.client?.totalHires ?? NaN);
  const posted = Number(node.client?.totalPostedJobs ?? NaN);
  const hireRate = Number.isFinite(hires) && Number.isFinite(posted) && posted > 0 ? Math.round((hires / posted) * 100) : null;
  const verification = String(node.client?.verificationStatus ?? '');

  return {
    upworkId: String(node.id),
    title: String(node.title ?? ''),
    description: String(node.description ?? ''),
    url: node.ciphertext ? `https://www.upwork.com/jobs/${node.ciphertext}` : `https://www.upwork.com/jobs/~${node.id}`,
    category: node.occupations?.category?.prefLabel ?? null,
    skills: Array.isArray(node.skills) ? node.skills.map((s: { prettyName?: string; name?: string }) => s.prettyName ?? s.name ?? '').filter(Boolean) : [],
    jobType: isHourly ? 'hourly' : 'fixed',
    budgetMin: isHourly ? hourlyMin : fixed,
    budgetMax: isHourly ? hourlyMax : null,
    experienceLevel: mapExperience(node.experienceLevel),
    clientCountry: node.client?.location?.country ?? null,
    clientPaymentVerified: verification ? verification.toUpperCase() === 'VERIFIED' : null,
    clientHireRate: hireRate,
    clientTotalSpend: num(node.client?.totalSpent),
    proposalsCount: node.totalApplicants != null ? Number(node.totalApplicants) : null,
    postedAt: node.createdDateTime ? new Date(node.createdDateTime) : null,
    raw: node,
  };
}

export class UpworkJobSource implements JobSource {
  readonly name = 'upwork';
  private accessToken: string | undefined;

  constructor(
    private readonly creds: UpworkCredentials,
    private readonly onTokenRefresh?: (tokens: { accessToken: string; refreshToken?: string }) => void,
  ) {
    this.accessToken = creds.accessToken;
  }

  async search(query: JobSearch): Promise<NormalizedJob[]> {
    const variables = {
      filter: {
        searchExpression_eq: query.terms.length ? query.terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ') : undefined,
        pagination_eq: { after: '0', first: query.limit },
      },
      sort: [{ field: 'RECENCY' }],
    };
    const data = await this.graphql(JOB_SEARCH_QUERY, variables);
    const edges = data?.marketplaceJobPostingsSearch?.edges ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return edges.map((e: any) => mapNode(e.node));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async graphql(query: string, variables: Record<string, unknown>, retried = false): Promise<any> {
    if (!this.accessToken) {
      throw new Error('Upwork access token missing. Set UPWORK_ACCESS_TOKEN (and UPWORK_REFRESH_TOKEN) in .env.');
    }
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 401 && !retried && this.creds.refreshToken) {
      await this.refresh();
      return this.graphql(query, variables, true);
    }
    if (!res.ok) {
      throw new Error(`Upwork API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const body = (await res.json()) as { data?: unknown; errors?: { message: string }[] };
    if (body.errors?.length) {
      throw new Error(`Upwork API error: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    return body.data;
  }

  private async refresh(): Promise<void> {
    const { clientId, clientSecret, refreshToken } = this.creds;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('Cannot refresh Upwork token: client id, secret and refresh token are required.');
    }
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Upwork token refresh failed: ${res.status}`);
    const tokens = (await res.json()) as { access_token: string; refresh_token?: string };
    this.accessToken = tokens.access_token;
    if (tokens.refresh_token) this.creds.refreshToken = tokens.refresh_token;
    this.onTokenRefresh?.({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token });
  }
}
