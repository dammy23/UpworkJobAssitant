// `npm run db:seed`: adds a demo account and two appliers that use sample jobs, so the app has something to show.
import { db, pool } from './client.js';
import { runMigrations } from './migrate.js';
import { appliers, materials, upworkAccounts } from './schema.js';
import { ensureProviders } from '../services/providers.js';

await runMigrations();
await ensureProviders();

const existing = await db.select().from(upworkAccounts);
if (existing.length > 0) {
  console.log('Database already has accounts; seed skipped.');
} else {
  const [acc] = await db.insert(upworkAccounts).values({ name: 'Demo', email: 'demo@example.com' }).returning();
  const [va] = await db
    .insert(appliers)
    .values({
      name: 'Virtual assistant',
      upworkAccountId: acc.id,
      category: 'Admin Support',
      roles: ['Virtual assistant', 'Executive assistant'],
      keywords: ['Calendar management', 'Email management', 'Data entry', 'Google Workspace', 'CRM'],
      excludeKeywords: ['Cold calling', 'Commission only'],
      minFixedBudget: 100,
      minHourlyRate: 12,
      profileSummary:
        'Virtual assistant with five years supporting founders and small agencies. I manage calendars, inboxes and travel in Google Workspace and send a short summary at the end of each day.',
      tone: 'Warm',
      scoreThreshold: 60,
    })
    .returning();
  await db.insert(materials).values({
    applierId: va.id,
    kind: 'portfolio',
    title: 'Founder support for a recruitment agency',
    description: 'Calendar, inbox triage and travel for a founder, with a daily wrap-up. Two years, ongoing.',
  });
  await db.insert(appliers).values({
    name: 'Content writer',
    upworkAccountId: acc.id,
    category: 'Writing',
    roles: ['Content writer', 'Copywriter'],
    keywords: ['Blog writing', 'SEO', 'Copywriting'],
    excludeKeywords: ['Commission only', 'Unpaid sample'],
    minFixedBudget: 150,
    profileSummary: 'UK-based writer covering personal finance and small business topics.',
    tone: 'Direct and specific',
    scoreThreshold: 60,
  });
  console.log('Seeded a demo account with two appliers. Open the app and press "Check now" on an applier.');
}
await pool.end();
