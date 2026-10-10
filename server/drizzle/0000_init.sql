CREATE TYPE "public"."application_status" AS ENUM('applied', 'viewed', 'replied', 'interview', 'hired', 'declined');--> statement-breakpoint
CREATE TYPE "public"."experience_level" AS ENUM('any', 'entry', 'intermediate', 'expert');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('any', 'fixed', 'hourly');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('filtered', 'below_threshold', 'pending_review', 'applied', 'skipped', 'bad_match');--> statement-breakpoint
CREATE TYPE "public"."material_kind" AS ENUM('resume', 'video', 'portfolio');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"applier_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"proposal_text" text NOT NULL,
	"connects_spent" integer,
	"status" "application_status" DEFAULT 'applied' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"category" text,
	"roles" text[] DEFAULT '{}' NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"exclude_keywords" text[] DEFAULT '{}' NOT NULL,
	"job_type" "job_type" DEFAULT 'any' NOT NULL,
	"min_fixed_budget" integer,
	"min_hourly_rate" integer,
	"experience_level" "experience_level" DEFAULT 'any' NOT NULL,
	"client_payment_verified" boolean DEFAULT true NOT NULL,
	"client_min_hire_rate" integer,
	"client_min_total_spend" integer,
	"max_proposals" integer,
	"excluded_countries" text[] DEFAULT '{}' NOT NULL,
	"profile_summary" text DEFAULT '' NOT NULL,
	"tone" text DEFAULT 'Direct and specific' NOT NULL,
	"max_words" integer DEFAULT 150 NOT NULL,
	"bid_rate" integer,
	"drafter_instructions" text DEFAULT '' NOT NULL,
	"score_threshold" integer DEFAULT 70 NOT NULL,
	"schedule_minutes" integer DEFAULT 30 NOT NULL,
	"telegram_enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applier_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"status" "match_status" NOT NULL,
	"filter_reason" text,
	"score" integer,
	"reasons" text,
	"red_flags" text,
	"draft" text,
	"model" text,
	"prompt_version" text,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upwork_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"url" text NOT NULL,
	"category" text,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"job_type" text NOT NULL,
	"budget_min" integer,
	"budget_max" integer,
	"experience_level" text,
	"client_country" text,
	"client_payment_verified" boolean,
	"client_hire_rate" integer,
	"client_total_spend" integer,
	"proposals_count" integer,
	"posted_at" timestamp with time zone,
	"raw" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applier_id" uuid NOT NULL,
	"kind" "material_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"file_name" text,
	"stored_name" text,
	"mime_type" text,
	"size_bytes" integer,
	"url" text,
	"use_in_proposals" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_match_id_job_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."job_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_applier_id_appliers_id_fk" FOREIGN KEY ("applier_id") REFERENCES "public"."appliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_applier_id_appliers_id_fk" FOREIGN KEY ("applier_id") REFERENCES "public"."appliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_applier_id_appliers_id_fk" FOREIGN KEY ("applier_id") REFERENCES "public"."appliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_match_idx" ON "applications" USING btree ("match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_matches_applier_job_idx" ON "job_matches" USING btree ("applier_id","job_id");--> statement-breakpoint
CREATE INDEX "job_matches_status_idx" ON "job_matches" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_upwork_id_idx" ON "jobs" USING btree ("upwork_id");--> statement-breakpoint
CREATE INDEX "materials_applier_idx" ON "materials" USING btree ("applier_id");