import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/db -> server/drizzle (works from src/ with tsx and from dist/ after build)
const migrationsFolder = path.resolve(here, '../../drizzle');

await migrate(db, { migrationsFolder });
console.log('Migrations applied.');
await pool.end();
