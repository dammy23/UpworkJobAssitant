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
  status: 'connected' | 'sample' | 'error'; // 'sample' = not signed in to Upwork; sample jobs and test sends
  hasClientId: boolean; hasClientSecret: boolean; hasAccessToken: boolean;
  canConnect: boolean;            // has client id + secret, so "Connect with Upwork" can start
  connectedAt: string | null; upworkUserName: string | null;
  lastSearchAt: string | null; lastError: string | null;
  applierCount: number;
  limits: { dailyProposalCap: number; minGapSeconds: number; weeklyConnectsBudget: number | null };
  usage: { sentToday: number; connectsThisWeek: number; nextSendAt: string | null };
};
type AccountInput = {
  name: string; email?: string;
  clientId?: string; clientSecret?: string; accessToken?: string; refreshToken?: string;
  dailyProposalCap?: number;          // 1–50, default 10
  minGapSeconds?: number;             // ≥ 60, default 180
  weeklyConnectsBudget?: number | null;
};
```

Signing in to Upwork (OAuth). The client id and secret come from the user's Upwork API key.

- `GET /accounts/:id/upwork/connect` → 302 to Upwork's approval page. **Open as a normal link (full page navigation), not with fetch.**
- `GET /upwork/callback` → Upwork redirects here; the server then redirects the browser to
  `/settings?connected=<accountId>` on success or `/settings?upworkError=<message>` on failure.
  Settings should show a success or error notice from these query params, then clear them.
- `POST /accounts/:id/upwork/disconnect` → `Account` (back to sample jobs)

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
  (uses the chat that last messaged the bot; the server listens for messages and Submit/Skip taps whenever a bot token is saved)
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
  defaultDuration: string; // suggested project duration on each proposal, e.g. 'Less than 1 month'
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

## Drafts and sending proposals

Every proposal is sent only after the user approves that specific draft, in the app (`POST /drafts/submit`)
or with the Submit button on its Telegram alert. Approved drafts wait in a queue and are sent one at a time per
Upwork account, with a gap between sends, a daily cap and an optional weekly Connects budget (account `limits`).
Accounts not signed in to Upwork do a **test send**: the whole flow runs but nothing goes to Upwork
(`sendMode: 'simulated'`, application `submittedVia: 'simulated'`).

Duration options (strings): 'Less than 1 month', '1 to 3 months', '3 to 6 months', 'More than 6 months'.

```ts
type JobView = {
  id: string; title: string; description: string; url: string; category: string | null; skills: string[];
  jobType: 'fixed' | 'hourly'; budgetMin: number | null; budgetMax: number | null; budgetLabel: string;
  experienceLevel: string | null; clientCountry: string | null; clientPaymentVerified: boolean | null;
  clientHireRate: number | null; clientTotalSpend: number | null; proposalsCount: number | null; postedAt: string | null;
  questions: string[];             // the client's screening questions
  connectsRequired: number | null;
};
type DraftState = 'ready' | 'queued' | 'sending' | 'failed'
  | 'sent' | 'skipped'; // only seen from GET /drafts/:id, e.g. opening an old Telegram link
type Draft = {
  id: string; state: DraftState;
  score: number; reasons: string; redFlags: string; draft: string; createdAt: string;
  bidAmount: number | null;        // USD: hourly rate for hourly jobs, total for fixed-price jobs
  duration: string | null;
  answers: { question: string; answer: string }[]; // one per job.questions, in order ('' = not answered)
  problems: string[];              // what stops it being sent, in plain words; [] = ready to approve
  sendMode: 'api' | 'simulated';
  queuedAt: string | null; approvedVia: 'app' | 'telegram' | null;
  waitReason: string | null;       // queued only: why it hasn't gone yet (daily limit, gap, budget)
  submitError: string | null;      // failed only
  applier: ApplierRef & { maxWords: number }; account: AccountRef; job: JobView;
  attachments: { id: string; kind: 'resume' | 'video' | 'portfolio'; title: string; fileName: string | null; url: string | null; downloadUrl: string | null }[];
};
```

- `GET /drafts?accountId=&sort=score|newest&state=ready|queued|failed` → `Draft[]` (no `state` = all open drafts)
- `GET /drafts/:id` → `Draft`
- `PATCH /drafts/:id` (`{ draft?, bidAmount?, duration?, answers? }`) → `Draft` (ready or failed drafts only; 409 while queued)
- `POST /drafts/:id/rewrite` (`{ instruction: 'new' | 'shorter' | 'warmer' | 'specific' }`) → `Draft`
- `POST /drafts/:id/answers/generate` → `Draft` (AI writes the screening answers; 400 without an AI provider)
- `POST /drafts/submit` (`{ items: ({ id } & { draft?, bidAmount?, duration?, answers? })[] }`, 1–50 items)
  → `{ results: { id: string; ok: boolean; error?: string }[]; drafts: Draft[]; queued: number }`.
  Approves each item (saving its edits first). An item that isn't complete returns `ok: false` with the reason;
  the others still go through. Also used to retry a failed draft.
- `POST /drafts/:id/unqueue` → `Draft` (back to ready; 409 once it's sending)
- `POST /drafts/:id/applied` (`{ connectsSpent: number | null; proposalText: string; bidAmount?: number | null }`) → `Application`
  (the user sent it themselves on the Upwork website)
- `POST /drafts/:id/skip` (`{ reason: 'skip' | 'bad_match' }`) → `204`

## Applied jobs

```ts
type Application = {
  id: string; status: AppStatus; connectsSpent: number | null; notes: string; proposalText: string;
  bidAmount: number | null;
  submittedVia: 'manual' | 'api' | 'simulated'; // 'manual' = sent on the website; 'simulated' = test send
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
  pendingDrafts: number;           // ready to review
  queue: { queued: number; failed: number };
  jobsCheckedLast24h: number;
  topDrafts: { id: string; score: number; title: string; budgetLabel: string; postedAt: string | null; applier: ApplierRef; account: AccountRef }[];
  week: { sent: number; sentByApp: number /* real sends through the app, not test sends */; connects: number; byStatus: Record<AppStatus, number> };
  appliers: { id: string; name: string; active: boolean; lastRunAt: string | null; pendingDrafts: number; account: AccountRef }[];
  accounts: { id: string; name: string; status: 'connected' | 'sample' | 'error' }[];
  setup: { hasAccount: boolean; hasProvider: boolean; hasApplier: boolean; hasTelegram: boolean };
};
```

- `GET /overview` → `Overview`
