# HTTP API

JSON over HTTP, all routes under `/api`. Errors return `{ "error": string }` with a 4xx/5xx status.
Dates are ISO strings. Money is whole US dollars. IDs are UUIDs except AI provider ids.

```ts
type ProviderId = 'groq' | 'claude' | 'openai' | 'ollama';
type JobType = 'any' | 'fixed' | 'hourly';
type Experience = 'any' | 'entry' | 'intermediate' | 'expert';
type AppStatus = 'applied' | 'viewed' | 'replied' | 'interview' | 'hired' | 'declined';
type AccountRef = { id: string; name: string };
type ApplierRef = { id: string; name: string };
```

## Upwork accounts

```ts
type Account = {
  id: string; name: string; email: string;
  status: 'connected' | 'sample' | 'error'; // 'sample' = no access token yet, sample jobs are used
  hasClientId: boolean; hasAccessToken: boolean;
  lastSearchAt: string | null; lastError: string | null;
  applierCount: number;
};
type AccountInput = {
  name: string; email?: string;
  clientId?: string; clientSecret?: string; accessToken?: string; refreshToken?: string;
};
```

- `GET /accounts` → `Account[]`
- `POST /accounts` (`AccountInput`) → `Account`
- `PATCH /accounts/:id` (partial `AccountInput`; a secret omitted = unchanged, `""` = cleared) → `Account`
- `DELETE /accounts/:id` → `204` (`409` while appliers still use it)

## AI providers

```ts
type Provider = {
  id: ProviderId; name: string; enabled: boolean;
  configured: boolean;            // has the key / server it needs
  needsKey: boolean; needsBaseUrl: boolean;
  apiKeyHint: string | null;      // e.g. "••••4f2A", never the key
  baseUrl: string | null; model: string; position: number;
  suggestedModels: string[];
  lastTestAt: string | null; lastTestOk: boolean | null; lastTestMessage: string | null;
};
```

- `GET /providers` → `Provider[]` sorted by `position`
- `PATCH /providers/:id` (`{ enabled?, apiKey?, baseUrl?, model? }`) → `Provider`
- `PUT /providers/order` (`{ order: ProviderId[] }`) → `Provider[]`
- `POST /providers/:id/test` → `{ ok: boolean; message: string }` (scores a sample job)
- `GET /providers/ollama/models?baseUrl=` → `{ models: string[] }`

## Telegram

- `GET /settings/telegram` → `{ configured: boolean; tokenHint: string | null; chatId: string | null }`
- `PUT /settings/telegram` (`{ botToken?: string; chatId?: string }`) → same as GET
- `POST /settings/telegram/find-chat` → `{ chatId: string | null; message: string }`
- `POST /settings/telegram/test` → `{ ok: boolean; message: string }`

## Appliers

```ts
type ApplierInput = {
  name: string; upworkAccountId: string; aiProvider: ProviderId | null; active: boolean;
  category: string | null; roles: string[]; keywords: string[]; excludeKeywords: string[];
  jobType: JobType; minFixedBudget: number | null; minHourlyRate: number | null; experienceLevel: Experience;
  clientPaymentVerified: boolean; clientMinHireRate: number | null; clientMinTotalSpend: number | null;
  maxProposals: number | null; excludedCountries: string[];
  profileSummary: string; tone: string; maxWords: number; bidRate: number | null; drafterInstructions: string;
  scoreThreshold: number; scheduleMinutes: number; telegramEnabled: boolean;
};
type Material = {
  id: string; kind: 'resume' | 'video' | 'portfolio'; title: string; description: string;
  fileName: string | null; mimeType: string | null; sizeBytes: number | null; url: string | null;
  useInProposals: boolean; wordCount: number; createdAt: string;
  downloadUrl: string | null;     // "/api/materials/:id/file" when a file was uploaded
};
type Applier = ApplierInput & { id: string; lastRunAt: string | null; createdAt: string; updatedAt: string };
type ApplierSummary = Applier & {
  account: AccountRef;
  materials: { resume: boolean; video: boolean; portfolioCount: number };
  stats7d: { found: number; passed: number; drafted: number };
  pendingDrafts: number;
};
type ApplierDetail = Applier & { account: AccountRef; materials: Material[] };
type RunSummary = { applierId: string; applierName: string; fetched: number; alreadySeen: number;
  filtered: number; belowThreshold: number; drafted: number; errors: string[] };
type Preview = {
  sampled: number; passed: number; wouldDraft: number;
  items: { title: string; score: number | null; outcome: 'draft' | 'below' | 'skipped'; reason: string }[];
};
```

- `GET /appliers` → `ApplierSummary[]`
- `GET /appliers/:id` → `ApplierDetail`
- `POST /appliers` (`ApplierInput`) → `ApplierDetail`
- `PUT /appliers/:id` (`ApplierInput`) → `ApplierDetail`
- `PATCH /appliers/:id/active` (`{ active: boolean }`) → `ApplierSummary`
- `DELETE /appliers/:id` → `204`
- `POST /appliers/:id/run` → `RunSummary`
- `POST /appliers/preview` (`ApplierInput`) → `Preview`. Applies the hard filters to the
  account's 50 most recent jobs and uses scores already recorded for them; no LLM calls.
- `GET /templates` → `{ id: string; name: string; note: string; input: Partial<ApplierInput> }[]`

### Materials

- `POST /appliers/:id/materials/resume` (multipart, field `file`, PDF/DOCX/TXT) → `Material` (text extracted into `description`)
- `POST /appliers/:id/materials/video` (multipart `file`, or JSON `{ url }`) → `Material`
- `POST /appliers/:id/materials/portfolio` (`{ title, description, useInProposals? }`) → `Material`
- `PATCH /materials/:id` (`{ title?, description?, useInProposals? }`) → `Material`
- `DELETE /materials/:id` → `204`
- `GET /materials/:id/file` → the file

## Drafts (jobs waiting for review)

```ts
type JobView = {
  id: string; title: string; description: string; url: string; category: string | null; skills: string[];
  jobType: 'fixed' | 'hourly'; budgetMin: number | null; budgetMax: number | null; budgetLabel: string;
  experienceLevel: string | null; clientCountry: string | null; clientPaymentVerified: boolean | null;
  clientHireRate: number | null; clientTotalSpend: number | null; proposalsCount: number | null; postedAt: string | null;
};
type Draft = {
  id: string; score: number; reasons: string; redFlags: string; draft: string; createdAt: string;
  applier: ApplierRef & { maxWords: number }; account: AccountRef; job: JobView;
  attachments: { id: string; kind: 'resume' | 'video' | 'portfolio'; title: string; fileName: string | null; url: string | null; downloadUrl: string | null }[];
};
```

- `GET /drafts?accountId=&sort=score|newest` → `Draft[]`
- `PATCH /drafts/:id` (`{ draft: string }`) → `Draft`
- `POST /drafts/:id/rewrite` (`{ instruction: 'new' | 'shorter' | 'warmer' | 'specific' }`) → `Draft`
- `POST /drafts/:id/applied` (`{ connectsSpent: number | null; proposalText: string }`) → `Application`
- `POST /drafts/:id/skip` (`{ reason: 'skip' | 'bad_match' }`) → `204`

## Applied jobs

```ts
type Application = {
  id: string; status: AppStatus; connectsSpent: number | null; notes: string; proposalText: string;
  appliedAt: string; updatedAt: string;
  job: { id: string; title: string; url: string; budgetLabel: string };
  applier: ApplierRef; account: AccountRef;
};
```

- `GET /applications?status=&accountId=&applierId=` → `{ items: Application[]; counts: Record<'all' | AppStatus, number>; connectsTotal: number }`
  (`counts` ignore the `status` filter so filter chips can show totals)
- `PATCH /applications/:id` (`{ status?, notes?, connectsSpent? }`) → `Application`
- `GET /applications.csv` → CSV download

## Home

```ts
type Overview = {
  pendingDrafts: number; jobsCheckedLast24h: number;
  topDrafts: { id: string; score: number; title: string; budgetLabel: string; postedAt: string | null; applier: ApplierRef; account: AccountRef }[];
  week: { sent: number; connects: number; byStatus: Record<AppStatus, number> };
  appliers: { id: string; name: string; active: boolean; lastRunAt: string | null; pendingDrafts: number; account: AccountRef }[];
  accounts: { id: string; name: string; status: 'connected' | 'sample' | 'error' }[];
  setup: { hasAccount: boolean; hasProvider: boolean; hasApplier: boolean; hasTelegram: boolean };
};
```

- `GET /overview` → `Overview`
