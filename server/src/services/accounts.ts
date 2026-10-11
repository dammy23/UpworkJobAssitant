import crypto from 'node:crypto';
import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appliers, applications, upworkAccounts, type UpworkAccount } from '../db/schema.js';
import { decryptOrUndefined, encrypt } from '../lib/crypto.js';
import { FixtureJobSource } from '../pipeline/sources/fixtures.js';
import { authorizeUrl, exchangeCode, UpworkClient } from '../pipeline/sources/upwork.js';
import type { JobSource } from '../pipeline/types.js';

export type AccountStatus = 'connected' | 'sample' | 'error';

export function accountStatus(a: UpworkAccount): AccountStatus {
  if (!a.accessTokenEnc) return 'sample';
  return a.lastError ? 'error' : 'connected';
}

/** Start of the current UTC day / ISO week (Monday). Limits reset at these times. */
export function dayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
export function weekStart(now = new Date()): Date {
  const d = dayStart(now);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - dow * 24 * 3600_000);
}

/** Proposals sent through the app today and Connects spent this week, per account. */
export async function usageFor(accountIds: string[]): Promise<Map<string, { sentToday: number; connectsThisWeek: number }>> {
  const out = new Map(accountIds.map((id) => [id, { sentToday: 0, connectsThisWeek: 0 }]));
  if (!accountIds.length) return out;
  const rows = await db
    .select({
      accountId: appliers.upworkAccountId,
      sentToday: sql<number>`count(*) filter (where ${applications.submittedVia} <> 'manual' and ${applications.appliedAt} >= ${dayStart().toISOString()})::int`,
      connects: sql<number>`coalesce(sum(${applications.connectsSpent}) filter (where ${applications.appliedAt} >= ${weekStart().toISOString()}), 0)::int`,
    })
    .from(applications)
    .innerJoin(appliers, eq(appliers.id, applications.applierId))
    .where(and(inArray(appliers.upworkAccountId, accountIds), gte(applications.appliedAt, weekStart())))
    .groupBy(appliers.upworkAccountId);
  for (const r of rows) out.set(r.accountId, { sentToday: r.sentToday, connectsThisWeek: r.connects });
  return out;
}

export async function toAccountView(a: UpworkAccount) {
  const [{ n }] = await db.select({ n: count() }).from(appliers).where(eq(appliers.upworkAccountId, a.id));
  const usage = (await usageFor([a.id])).get(a.id)!;
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    status: accountStatus(a),
    hasClientId: Boolean(a.clientId),
    hasClientSecret: Boolean(a.clientSecretEnc),
    hasAccessToken: Boolean(a.accessTokenEnc),
    canConnect: Boolean(a.clientId && a.clientSecretEnc),
    connectedAt: a.connectedAt?.toISOString() ?? null,
    upworkUserName: a.upworkUserName,
    lastSearchAt: a.lastSearchAt?.toISOString() ?? null,
    lastError: a.lastError,
    applierCount: Number(n),
    limits: {
      dailyProposalCap: a.dailyProposalCap,
      minGapSeconds: a.minGapSeconds,
      weeklyConnectsBudget: a.weeklyConnectsBudget,
    },
    usage: {
      sentToday: usage.sentToday,
      connectsThisWeek: usage.connectsThisWeek,
      nextSendAt: a.nextSubmitAt && a.nextSubmitAt.getTime() > Date.now() ? a.nextSubmitAt.toISOString() : null,
    },
  };
}

export interface AccountInput {
  name?: string;
  email?: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  dailyProposalCap?: number;
  minGapSeconds?: number;
  weeklyConnectsBudget?: number | null;
}

/** Maps API input to columns. Omitted secret = unchanged; empty string = cleared. */
export function accountColumns(input: AccountInput): Partial<typeof upworkAccounts.$inferInsert> {
  const set: Partial<typeof upworkAccounts.$inferInsert> = {};
  if (input.name !== undefined) set.name = input.name.trim();
  if (input.email !== undefined) set.email = input.email.trim();
  if (input.clientId !== undefined) set.clientId = input.clientId.trim() || null;
  const secret = (v: string | undefined) => (v === undefined ? undefined : v.trim() ? encrypt(v.trim()) : null);
  const cs = secret(input.clientSecret);
  if (cs !== undefined) set.clientSecretEnc = cs;
  const at = secret(input.accessToken);
  if (at !== undefined) {
    set.accessTokenEnc = at;
    set.lastError = null; // a new token gets a fresh start
    if (at === null) {
      set.connectedAt = null;
      set.tenantId = null;
      set.upworkUserName = null;
    }
  }
  const rt = secret(input.refreshToken);
  if (rt !== undefined) set.refreshTokenEnc = rt;
  if (input.dailyProposalCap !== undefined) set.dailyProposalCap = input.dailyProposalCap;
  if (input.minGapSeconds !== undefined) set.minGapSeconds = input.minGapSeconds;
  if (input.weeklyConnectsBudget !== undefined) set.weeklyConnectsBudget = input.weeklyConnectsBudget;
  return set;
}

/** An API client for an account that has signed in; saves refreshed tokens automatically. */
export function clientFor(a: UpworkAccount): UpworkClient {
  return new UpworkClient(
    {
      clientId: a.clientId ?? undefined,
      clientSecret: decryptOrUndefined(a.clientSecretEnc),
      accessToken: decryptOrUndefined(a.accessTokenEnc),
      refreshToken: decryptOrUndefined(a.refreshTokenEnc),
      tenantId: a.tenantId ?? undefined,
    },
    async (tokens) => {
      await db
        .update(upworkAccounts)
        .set({
          accessTokenEnc: encrypt(tokens.accessToken),
          ...(tokens.refreshToken ? { refreshTokenEnc: encrypt(tokens.refreshToken) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(upworkAccounts.id, a.id));
    },
  );
}

const fixtures = new FixtureJobSource();

/** The job source for an account: the real Upwork API once it has signed in, sample jobs until then. */
export function jobSourceFor(a: UpworkAccount): JobSource {
  return a.accessTokenEnc ? clientFor(a) : fixtures;
}

// ---- Sign-in ----

const STATE_TTL_MS = 15 * 60_000;

/** Starts sign-in: remembers a one-time state and returns Upwork's approval page. */
export async function beginConnect(a: UpworkAccount): Promise<string> {
  if (!a.clientId || !a.clientSecretEnc) {
    throw new Error('Add this account’s Upwork client ID and secret first.');
  }
  const state = crypto.randomBytes(24).toString('base64url');
  await db
    .update(upworkAccounts)
    .set({ oauthState: state, oauthStateAt: new Date(), updatedAt: new Date() })
    .where(eq(upworkAccounts.id, a.id));
  return authorizeUrl(a.clientId, state);
}

/** Finishes sign-in from Upwork's redirect: swaps the code for tokens and looks up the organisation. */
export async function completeConnect(state: string, code: string): Promise<UpworkAccount> {
  const [a] = await db.select().from(upworkAccounts).where(eq(upworkAccounts.oauthState, state));
  if (!a || !a.oauthStateAt || Date.now() - a.oauthStateAt.getTime() > STATE_TTL_MS) {
    throw new Error('This sign-in link has expired. Start again from Settings.');
  }
  const secret = decryptOrUndefined(a.clientSecretEnc);
  if (!a.clientId || !secret) throw new Error('The account is missing its client ID or secret.');
  const tokens = await exchangeCode(code, a.clientId, secret);

  let tenantId: string | null = null;
  let userName: string | null = null;
  try {
    const companies = await new UpworkClient({ accessToken: tokens.accessToken }).companies();
    tenantId = companies[0]?.organizationId ?? null;
    userName = companies[0]?.title ?? null;
  } catch (err) {
    console.warn(`[upwork] couldn't read organisations after sign-in: ${(err as Error).message}`);
  }

  const [updated] = await db
    .update(upworkAccounts)
    .set({
      accessTokenEnc: encrypt(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      tenantId,
      upworkUserName: userName,
      connectedAt: new Date(),
      lastError: null,
      oauthState: null,
      oauthStateAt: null,
      updatedAt: new Date(),
    })
    .where(eq(upworkAccounts.id, a.id))
    .returning();
  return updated;
}
