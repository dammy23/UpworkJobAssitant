import { count, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appliers, upworkAccounts, type UpworkAccount } from '../db/schema.js';
import { decryptOrUndefined, encrypt } from '../lib/crypto.js';
import { FixtureJobSource } from '../pipeline/sources/fixtures.js';
import { UpworkJobSource } from '../pipeline/sources/upwork.js';
import type { JobSource } from '../pipeline/types.js';

export type AccountStatus = 'connected' | 'sample' | 'error';

export function accountStatus(a: UpworkAccount): AccountStatus {
  if (!a.accessTokenEnc) return 'sample';
  return a.lastError ? 'error' : 'connected';
}

export async function toAccountView(a: UpworkAccount) {
  const [{ n }] = await db.select({ n: count() }).from(appliers).where(eq(appliers.upworkAccountId, a.id));
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    status: accountStatus(a),
    hasClientId: Boolean(a.clientId),
    hasAccessToken: Boolean(a.accessTokenEnc),
    lastSearchAt: a.lastSearchAt?.toISOString() ?? null,
    lastError: a.lastError,
    applierCount: Number(n),
  };
}

export interface AccountInput {
  name?: string;
  email?: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
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
  }
  const rt = secret(input.refreshToken);
  if (rt !== undefined) set.refreshTokenEnc = rt;
  return set;
}

const fixtures = new FixtureJobSource();

/** The job source for an account: the real Upwork API once it has a token, sample jobs until then. */
export function jobSourceFor(a: UpworkAccount): JobSource {
  if (!a.accessTokenEnc) return fixtures;
  return new UpworkJobSource(
    {
      clientId: a.clientId ?? undefined,
      clientSecret: decryptOrUndefined(a.clientSecretEnc),
      accessToken: decryptOrUndefined(a.accessTokenEnc),
      refreshToken: decryptOrUndefined(a.refreshTokenEnc),
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
