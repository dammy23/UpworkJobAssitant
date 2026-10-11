import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().default('postgres://assistant:assistant@localhost:5432/upwork_assistant'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  UPLOAD_DIR: z.string().default('./uploads'),
  /** Encrypts API keys and tokens at rest. Generated into DATA_DIR on first run when not set. */
  APP_SECRET: z.string().min(16).optional(),
  DATA_DIR: z.string().default('./data'),
  /** Turn the background schedule off (e.g. in tests). */
  SCHEDULER: z.enum(['on', 'off']).default('on'),
  /** Base URL of the web UI, used in Telegram links. */
  WEB_BASE_URL: z.string().default('http://localhost:5173'),
});

// Treat empty strings in .env as "not set".
const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ''));
const parsed = EnvSchema.parse(raw);

const here = path.dirname(fileURLToPath(import.meta.url));
/** server/ (works from src/ with tsx and from dist/ after build) */
export const serverRoot = path.resolve(here, '..');

export const config = {
  ...parsed,
  uploadDir: path.resolve(serverRoot, parsed.UPLOAD_DIR),
  dataDir: path.resolve(serverRoot, parsed.DATA_DIR),
  webDist: path.resolve(serverRoot, '../web/dist'),
  migrationsDir: path.resolve(serverRoot, 'drizzle'),
};

export type Config = typeof config;
