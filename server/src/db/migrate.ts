import { pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config } from '../config.js';
import { db, pool } from './client.js';

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: config.migrationsDir });
}

// `npm run db:migrate`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await runMigrations();
  console.log('Migrations applied.');
  await pool.end();
}
