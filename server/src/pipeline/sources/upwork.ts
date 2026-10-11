import { config } from '../../config.js';
import type { JobSearch, JobSource, NormalizedJob } from '../types.js';

/**
 * Upwork's official GraphQL API: sign-in, job search and proposal submission.
 * Everything Upwork-specific lives in this file.
 *
 * Field names below follow Upwork's documentation. Once your API key is approved, run
 * `npm run upwork:schema` to print the live input/response types and adjust
 * JOB_SEARCH_QUERY, mapNode(), SUBMIT_PROPOSAL_MUTATION and buildProposalInput() if needed.
 */

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

export const COMPANY_SELECTOR_QUERY = /* GraphQL */ `
  query { companySelector { items { title organizationId } } }
`;

export const SUBMIT_PROPOSAL_MUTATION = /* GraphQL */ `
  mutation CreateJobProposal($input: CreateJobProposalInput!) {
    createJobProposal(input: $input) {
      __typename
    }
  }
`;

export interface ProposalToSend {
  jobUpworkId: string;
  jobCiphertext: string | null;
  jobType: 'fixed' | 'hourly';
  coverLetter: string;
  bidAmount: number; // USD: hourly rate, or fixed total
  duration: string | null;
  answers: { question: string; answer: string }[];
}

export interface SubmitResult {
  proposalId: string | null;
  connectsSpent: number | null;
  raw: unknown;
}

/**
 * Maps a proposal to CreateJobProposalInput. This is a best reading of Upwork's docs and must be
 * checked against the live schema (`npm run upwork:schema`) before the first real send.
 */
export function buildProposalInput(p: ProposalToSend): Record<string, unknown> {
  return {
    jobPostingId: p.jobUpworkId,
    coverLetter: p.coverLetter,
    ...(p.jobType === 'hourly'
      ? { chargeRate: { rawValue: String(p.bidAmount), currency: 'USD' } }
      : { amount: { rawValue: String(p.bidAmount), currency: 'USD' } }),
    ...(p.duration ? { estimatedDuration: p.duration } : {}),
    ...(p.answers.length ? { questionAnswers: p.answers.map((a) => ({ question: a.question, answer: a.answer })) } : {}),
  };
}

export interface UpworkCredentials {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tenantId?: string;
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
  const questions = Array.isArray(node.questions)
    ? node.questions.map((q: { question?: string } | string) => (typeof q === 'string' ? q : (q.question ?? ''))).filter(Boolean)
    : [];

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
    questions,
    connectsRequired: node.connectPrice != null ? Number(node.connectPrice) : null,
    raw: node,
  };
}

// ---- Sign-in (OAuth 2.0 authorization code) ----

export function authorizeUrl(clientId: string, state: string): string {
  const u = new URL(config.UPWORK_AUTHORIZE_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', config.UPWORK_REDIRECT_URI);
  u.searchParams.set('state', state);
  return u.toString();
}

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  const res = await fetch(config.UPWORK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Upwork sign-in failed (${res.status}): ${text.slice(0, 200)}`);
  const body = JSON.parse(text) as { access_token?: string; refresh_token?: string };
  if (!body.access_token) throw new Error('Upwork did not return an access token');
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

export function exchangeCode(code: string, clientId: string, clientSecret: string): Promise<Tokens> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.UPWORK_REDIRECT_URI,
    client_id: clientId,
    client_secret: clientSecret,
  });
}

/** A GraphQL error Upwork returned (as opposed to a network failure). Not worth retrying unchanged. */
export class UpworkRejected extends Error {}

export class UpworkClient implements JobSource {
  readonly name = 'upwork';
  private accessToken: string | undefined;

  constructor(
    private readonly creds: UpworkCredentials,
    private readonly onTokenRefresh?: (tokens: Tokens) => void | Promise<void>,
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

  /** The organisations this login can act for; the first is used as the tenant. */
  async companies(): Promise<{ title: string; organizationId: string }[]> {
    const data = await this.graphql(COMPANY_SELECTOR_QUERY, {});
    return data?.companySelector?.items ?? [];
  }

  async submitProposal(p: ProposalToSend): Promise<SubmitResult> {
    const data = await this.graphql(SUBMIT_PROPOSAL_MUTATION, { input: buildProposalInput(p) });
    const r = data?.createJobProposal ?? {};
    return {
      proposalId: r.id ?? r.proposalId ?? r.proposal?.id ?? null,
      connectsSpent: r.connectsCharged ?? r.connects ?? null,
      raw: r,
    };
  }

  /** Prints a type's fields from the live schema (used by `npm run upwork:schema`). */
  async describeType(name: string): Promise<unknown> {
    const data = await this.graphql(
      `query T($n: String!) { __type(name: $n) { name kind inputFields { name type { name kind ofType { name kind ofType { name kind } } } } fields { name type { name kind ofType { name kind } } } } }`,
      { n: name },
    );
    return data?.__type ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async graphql(query: string, variables: Record<string, unknown>, retried = false): Promise<any> {
    if (!this.accessToken) throw new Error('This account is not signed in to Upwork yet.');
    const res = await fetch(config.UPWORK_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        ...(this.creds.tenantId ? { 'X-Upwork-API-TenantId': this.creds.tenantId } : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(60_000),
    });

    if (res.status === 401 && !retried && this.creds.refreshToken) {
      await this.refresh();
      return this.graphql(query, variables, true);
    }
    if (!res.ok) throw new Error(`Upwork API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { data?: unknown; errors?: { message: string }[] };
    if (body.errors?.length) throw new UpworkRejected(`Upwork said: ${body.errors.map((e) => e.message).join('; ')}`);
    return body.data;
  }

  private async refresh(): Promise<void> {
    const { clientId, clientSecret, refreshToken } = this.creds;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('The Upwork sign-in has expired. Connect the account again in Settings.');
    }
    const tokens = await tokenRequest({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });
    this.accessToken = tokens.accessToken;
    if (tokens.refreshToken) this.creds.refreshToken = tokens.refreshToken;
    await this.onTokenRefresh?.(tokens);
  }
}
