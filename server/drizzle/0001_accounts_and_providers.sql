CREATE TYPE "public"."ai_provider_id" AS ENUM('groq', 'claude', 'openai', 'ollama');--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" "ai_provider_id" PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"api_key_enc" text,
	"base_url" text,
	"model" text NOT NULL,
	"position" integer NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upwork_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"client_id" text,
	"client_secret_enc" text,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"last_search_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appliers" ADD COLUMN "upwork_account_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "appliers" ADD COLUMN "ai_provider" "ai_provider_id";--> statement-breakpoint
ALTER TABLE "appliers" ADD CONSTRAINT "appliers_upwork_account_id_upwork_accounts_id_fk" FOREIGN KEY ("upwork_account_id") REFERENCES "public"."upwork_accounts"("id") ON DELETE restrict ON UPDATE no action;