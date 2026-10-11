// `npm run upwork:schema -- <account name>`: prints the live Upwork types the app relies on,
// so the job search and proposal mapping in pipeline/sources/upwork.ts can be checked.
import { eq } from 'drizzle-orm';
import { db, pool } from './db/client.js';
import { upworkAccounts } from './db/schema.js';
import { clientFor } from './services/accounts.js';

const name = process.argv[2];
const rows = name ? await db.select().from(upworkAccounts).where(eq(upworkAccounts.name, name)) : await db.select().from(upworkAccounts);
const account = rows.find((r) => r.accessTokenEnc);
if (!account) {
  console.log('No signed-in Upwork account found. Connect one in Settings first.');
} else {
  const client = clientFor(account);
  for (const t of ['CreateJobProposalInput', 'CreateJobProposalResponse', 'MarketplaceJobPosting', 'MarketplaceJobPostingsSearchFilter']) {
    try {
      console.log(`\n=== ${t} ===\n${JSON.stringify(await client.describeType(t), null, 2)}`);
    } catch (err) {
      console.log(`\n=== ${t} ===\n${(err as Error).message}`);
    }
  }
}
await pool.end();
