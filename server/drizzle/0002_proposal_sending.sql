CREATE TYPE "public"."submitted_via" AS ENUM('manual', 'api', 'simulated');--> statement-breakpoint
ALTER TYPE "public"."match_status" ADD VALUE 'queued';--> statement-breakpoint
ALTER TYPE "public"."match_status" ADD VALUE 'sending';--> statement-breakpoint
ALTER TYPE "public"."match_status" ADD VALUE 'submit_failed';--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "bid_amount" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "submitted_via" "submitted_via" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "upwork_proposal_id" text;--> statement-breakpoint
ALTER TABLE "appliers" ADD COLUMN "default_duration" text DEFAULT 'Less than 1 month' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_matches" ADD COLUMN "telegram_message_id" integer;--> statement-breakpoint
ALTER TABLE "job_matches" ADD COLUMN "bid_amount" integer;--> statement-breakpoint
ALTER TABLE "job_matches" ADD COLUMN "duration" text;--> statement-breakpoint
ALTER TABLE "job_matches" ADD COLUMN "answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "job_matches" ADD COLUMN "queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_matches" ADD COLUMN "approved_via" text;--> statement-breakpoint
ALTER TABLE "job_matches" ADD COLUMN "submit_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_matches" ADD COLUMN "submit_error" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "questions" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "connects_required" integer;--> statement-breakpoint
ALTER TABLE "upwork_accounts" ADD COLUMN "oauth_state" text;--> statement-breakpoint
ALTER TABLE "upwork_accounts" ADD COLUMN "oauth_state_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "upwork_accounts" ADD COLUMN "connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "upwork_accounts" ADD COLUMN "upwork_user_name" text;--> statement-breakpoint
ALTER TABLE "upwork_accounts" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "upwork_accounts" ADD COLUMN "daily_proposal_cap" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "upwork_accounts" ADD COLUMN "min_gap_seconds" integer DEFAULT 180 NOT NULL;--> statement-breakpoint
ALTER TABLE "upwork_accounts" ADD COLUMN "weekly_connects_budget" integer;--> statement-breakpoint
ALTER TABLE "upwork_accounts" ADD COLUMN "last_submit_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "upwork_accounts" ADD COLUMN "next_submit_at" timestamp with time zone;