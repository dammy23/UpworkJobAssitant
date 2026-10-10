import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

export const jobTypeEnum = pgEnum('job_type', ['any', 'fixed', 'hourly']);
export const experienceEnum = pgEnum('experience_level', ['any', 'entry', 'intermediate', 'expert']);
export const materialKindEnum = pgEnum('material_kind', ['resume', 'video', 'portfolio']);
export const matchStatusEnum = pgEnum('match_status', [
  'filtered', // failed a hard filter
  'below_threshold', // scored, but under the applier's minimum
  'pending_review', // drafted and waiting for the user
  'applied', // user submitted on Upwork and marked it applied
  'skipped', // user skipped it
  'bad_match', // user flagged it as a bad match (feedback for tuning)
]);
export const applicationStatusEnum = pgEnum('application_status', [
  'applied',
  'viewed',
  'replied',
  'interview',
  'hired',
  'declined',
]);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * An applier is a saved search + proposal profile. It works for any kind of role
 * (admin, writing, design, accounting, development…): the category, role titles and
 * keywords decide what it looks for.
 */
export const appliers = pgTable('appliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),

  // What to look for
  category: text('category'), // Upwork category name, null = any
  roles: text('roles').array().notNull().default([]), // job titles, e.g. "Virtual assistant"
  keywords: text('keywords').array().notNull().default([]), // must include any of
  excludeKeywords: text('exclude_keywords').array().notNull().default([]),
  jobType: jobTypeEnum('job_type').notNull().default('any'),
  minFixedBudget: integer('min_fixed_budget'), // USD
  minHourlyRate: integer('min_hourly_rate'), // USD/hr
  experienceLevel: experienceEnum('experience_level').notNull().default('any'),

  // Client quality
  clientPaymentVerified: boolean('client_payment_verified').notNull().default(true),
  clientMinHireRate: integer('client_min_hire_rate'), // percent
  clientMinTotalSpend: integer('client_min_total_spend'), // USD
  maxProposals: integer('max_proposals'), // skip jobs that already have this many or more
  excludedCountries: text('excluded_countries').array().notNull().default([]),

  // About you (what the LLM reads when scoring and drafting)
  profileSummary: text('profile_summary').notNull().default(''),

  // Proposal style
  tone: text('tone').notNull().default('Direct and specific'),
  maxWords: integer('max_words').notNull().default(150),
  bidRate: integer('bid_rate'), // USD/hr, optional
  drafterInstructions: text('drafter_instructions').notNull().default(''),

  // Scoring and schedule
  scoreThreshold: integer('score_threshold').notNull().default(70),
  scheduleMinutes: integer('schedule_minutes').notNull().default(30),
  telegramEnabled: boolean('telegram_enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),

  ...timestamps,
});

/** Resume, intro video and portfolio items attached to an applier. */
export const materials = pgTable(
  'materials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applierId: uuid('applier_id')
      .notNull()
      .references(() => appliers.id, { onDelete: 'cascade' }),
    kind: materialKindEnum('kind').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''), // portfolio write-up, or extracted resume text
    fileName: text('file_name'), // original name of an uploaded file
    storedName: text('stored_name'), // name on disk under UPLOAD_DIR
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    url: text('url'), // e.g. a Loom/YouTube link for a video
    useInProposals: boolean('use_in_proposals').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('materials_applier_idx').on(t.applierId)],
);

/** Every job fetched from the job source, de-duplicated by Upwork's id. */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    upworkId: text('upwork_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    url: text('url').notNull(),
    category: text('category'),
    skills: text('skills').array().notNull().default([]),
    jobType: text('job_type').notNull(), // 'fixed' | 'hourly'
    budgetMin: integer('budget_min'), // USD (fixed amount, or hourly min)
    budgetMax: integer('budget_max'), // USD (hourly max)
    experienceLevel: text('experience_level'),
    clientCountry: text('client_country'),
    clientPaymentVerified: boolean('client_payment_verified'),
    clientHireRate: integer('client_hire_rate'),
    clientTotalSpend: integer('client_total_spend'),
    proposalsCount: integer('proposals_count'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    raw: jsonb('raw'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('jobs_upwork_id_idx').on(t.upworkId)],
);

/** One row per (applier, job): filter result, LLM score, draft and review status. */
export const jobMatches = pgTable(
  'job_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applierId: uuid('applier_id')
      .notNull()
      .references(() => appliers.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    status: matchStatusEnum('status').notNull(),
    filterReason: text('filter_reason'),
    score: integer('score'),
    reasons: text('reasons'),
    redFlags: text('red_flags'),
    draft: text('draft'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('job_matches_applier_job_idx').on(t.applierId, t.jobId),
    index('job_matches_status_idx').on(t.status),
  ],
);

/** Proposals the user submitted themselves on Upwork, and how they went. */
export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => jobMatches.id, { onDelete: 'cascade' }),
    applierId: uuid('applier_id')
      .notNull()
      .references(() => appliers.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    proposalText: text('proposal_text').notNull(),
    connectsSpent: integer('connects_spent'),
    status: applicationStatusEnum('status').notNull().default('applied'),
    notes: text('notes').notNull().default(''),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('applications_match_idx').on(t.matchId)],
);

export type Applier = typeof appliers.$inferSelect;
export type NewApplier = typeof appliers.$inferInsert;
export type Material = typeof materials.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobMatch = typeof jobMatches.$inferSelect;
export type Application = typeof applications.$inferSelect;
