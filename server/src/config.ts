import path from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().default('postgres://assistant:assistant@localhost:5432/upwork_assistant'),
  PORT: z.coerce.number().int().positive().default(4000),
  UPLOAD_DIR: z.string().default('./uploads'),
  JOB_SOURCE: z.enum(['fixtures', 'upwork']).default('fixtures'),

  UPWORK_CLIENT_ID: z.string().optional(),
  UPWORK_CLIENT_SECRET: z.string().optional(),
  UPWORK_ACCESS_TOKEN: z.string().optional(),
  UPWORK_REFRESH_TOKEN: z.string().optional(),

  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  FALLBACK_LLM_BASE_URL: z.string().optional(),
  FALLBACK_LLM_API_KEY: z.string().optional(),
  FALLBACK_LLM_MODEL: z.string().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  WEB_BASE_URL: z.string().default('http://localhost:5173'),
});

// Treat empty strings in .env as "not set".
const raw = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ''),
);

const parsed = EnvSchema.parse(raw);

export const config = {
  ...parsed,
  uploadDir: path.resolve(process.cwd(), parsed.UPLOAD_DIR),
};

export type Config = typeof config;
