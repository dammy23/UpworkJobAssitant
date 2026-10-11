// `npm run pipeline:once`: run every active applier now and print what happened.
import { pool } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { ensureProviders } from '../services/providers.js';
import { runDueAppliers } from './run.js';

await runMigrations();
await ensureProviders();
const results = await runDueAppliers({ force: true });
if (results.length === 0) console.log('No active appliers. Create one in the web app first.');
for (const r of results) console.log(JSON.stringify(r, null, 2));
await pool.end();
