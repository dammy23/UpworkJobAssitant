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
  /** Address of the web app, used in Telegram links and after Upwork sign-in. */
  WEB_BASE_URL: z.string().default('http://localhost:4000'),
  /** Must match the Callback URL on your Upwork API key. */
  UPWORK_REDIRECT_URI: z.string().default('http://localhost:4000/api/upwork/callback'),
  /** Turn the proposal send queue off (proposals stay queued). */
  SEND_QUEUE: z.enum(['on', 'off']).default('on'),

  // Service addresses. Only change these to point at a test double.
  UPWORK_AUTHORIZE_URL: z.string().default('https://www.upwork.com/ab/account-security/oauth2/authorize'),
  UPWORK_TOKEN_URL: z.string().default('https://www.upwork.com/api/v3/oauth2/token'),
  UPWORK_GRAPHQL_URL: z.string().default('https://api.upwork.com/graphql'),
  TELEGRAM_API_URL: z.string().default('https://api.telegram.org'),
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
