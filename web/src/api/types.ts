// Mirrors docs/API.md exactly. Keep in sync with the contract.

export type ProviderId = 'groq' | 'claude' | 'openai' | 'ollama';
export type JobType = 'any' | 'fixed' | 'hourly';
export type Experience = 'any' | 'entry' | 'intermediate' | 'expert';
export type AppStatus = 'applied' | 'viewed' | 'replied' | 'interview' | 'hired' | 'declined';
export type AccountRef = { id: string; name: string };
export type ApplierRef = { id: string; name: string };

export type AccountStatus = 'connected' | 'sample' | 'error';

// Upwork accounts
export type Account = {
  id: string;
  name: string;
  email: string;
  status: AccountStatus;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasAccessToken: boolean;
  canConnect: boolean;
  connectedAt: string | null;
  upworkUserName: string | null;
  lastSearchAt: string | null;
  lastError: string | null;
  applierCount: number;
  limits: AccountLimits;
  usage: { sentToday: number; connectsThisWeek: number; nextSendAt: string | null };
};
export type AccountLimits = { dailyProposalCap: number; minGapSeconds: number; weeklyConnectsBudget: number | null };
export type AccountInput = {
  name: string;
  email?: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  dailyProposalCap?: number;
  minGapSeconds?: number;
  weeklyConnectsBudget?: number | null;
};

// AI providers
export type Provider = {
  id: ProviderId;
  name: string;
  enabled: boolean;
  configured: boolean;
  needsKey: boolean;
  needsBaseUrl: boolean;
  apiKeyHint: string | null;
  baseUrl: string | null;
  model: string;
  position: number;
  suggestedModels: string[];
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
};
export type ProviderPatch = { enabled?: boolean; apiKey?: string; baseUrl?: string; model?: string };
export type TestResult = { ok: boolean; message: string };

// Telegram
export type TelegramSettings = { configured: boolean; tokenHint: string | null; chatId: string | null };
export type TelegramInput = { botToken?: string; chatId?: string };
export type FindChatResult = { chatId: string | null; message: string };

// Appliers
export type ApplierInput = {
  name: string;
  upworkAccountId: string;
  aiProvider: ProviderId | null;
  active: boolean;
  category: string | null;
  roles: string[];
  keywords: string[];
  excludeKeywords: string[];
  jobType: JobType;
  minFixedBudget: number | null;
  minHourlyRate: number | null;
  experienceLevel: Experience;
  clientPaymentVerified: boolean;
  clientMinHireRate: number | null;
  clientMinTotalSpend: number | null;
  maxProposals: number | null;
  excludedCountries: string[];
  profileSummary: string;
  tone: string;
  maxWords: number;
  bidRate: number | null;
  drafterInstructions: string;
  scoreThreshold: number;
  scheduleMinutes: number;
  telegramEnabled: boolean;
  defaultDuration: string;
};
export type MaterialKind = 'resume' | 'video' | 'portfolio';
export type Material = {
  id: string;
  kind: MaterialKind;
  title: string;
  description: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  url: string | null;
  useInProposals: boolean;
  wordCount: number;
  createdAt: string;
  downloadUrl: string | null;
};
export type Applier = ApplierInput & { id: string; lastRunAt: string | null; createdAt: string; updatedAt: string };
export type ApplierSummary = Applier & {
  account: AccountRef;
  materials: { resume: boolean; video: boolean; portfolioCount: number };
  stats7d: { found: number; passed: number; drafted: number };
  pendingDrafts: number;
};
export type ApplierDetail = Applier & { account: AccountRef; materials: Material[] };
export type RunSummary = {
  applierId: string;
  applierName: string;
  fetched: number;
  alreadySeen: number;
  filtered: number;
  belowThreshold: number;
  drafted: number;
  errors: string[];
};
export type PreviewOutcome = 'draft' | 'below' | 'skipped';
export type Preview = {
  sampled: number;
  passed: number;
  wouldDraft: number;
  items: { title: string; score: number | null; outcome: PreviewOutcome; reason: string }[];
};
export type Template = { id: string; name: string; note: string; input: Partial<ApplierInput> };
export type MaterialPatch = { title?: string; description?: string; useInProposals?: boolean };
export type PortfolioInput = { title: string; description: string; useInProposals?: boolean };

// Drafts
export type JobView = {
  id: string;
  title: string;
  description: string;
  url: string;
  category: string | null;
  skills: string[];
  jobType: 'fixed' | 'hourly';
  budgetMin: number | null;
  budgetMax: number | null;
  budgetLabel: string;
  experienceLevel: string | null;
  clientCountry: string | null;
  clientPaymentVerified: boolean | null;
  clientHireRate: number | null;
  clientTotalSpend: number | null;
  proposalsCount: number | null;
  postedAt: string | null;
  questions: string[];
  connectsRequired: number | null;
};
export type DraftAttachment = {
  id: string;
  kind: MaterialKind;
  title: string;
  fileName: string | null;
  url: string | null;
  downloadUrl: string | null;
};
export const DURATIONS = ['Less than 1 month', '1 to 3 months', '3 to 6 months', 'More than 6 months'] as const;
/** 'sent' and 'skipped' only come from GET /drafts/:id (e.g. an old Telegram link). */
export type DraftState = 'ready' | 'queued' | 'sending' | 'failed' | 'sent' | 'skipped';
export type SendMode = 'api' | 'simulated';
export type DraftAnswer = { question: string; answer: string };
export type Draft = {
  id: string;
  state: DraftState;
  score: number;
  reasons: string;
  redFlags: string;
  draft: string;
  createdAt: string;
  bidAmount: number | null;
  duration: string | null;
  answers: DraftAnswer[];
  problems: string[];
  sendMode: SendMode;
  queuedAt: string | null;
  approvedVia: 'app' | 'telegram' | null;
  waitReason: string | null;
  submitError: string | null;
  applier: ApplierRef & { maxWords: number };
  account: AccountRef;
  job: JobView;
  attachments: DraftAttachment[];
};
export type DraftSort = 'score' | 'newest';
export type DraftEdits = { draft?: string; bidAmount?: number | null; duration?: string | null; answers?: DraftAnswer[] };
export type SubmitItem = { id: string } & DraftEdits;
export type SubmitResult = { results: { id: string; ok: boolean; error?: string }[]; drafts: Draft[]; queued: number };
export type RewriteInstruction = 'new' | 'shorter' | 'warmer' | 'specific';
export type SkipReason = 'skip' | 'bad_match';

// Applied jobs
export type Application = {
  id: string;
  status: AppStatus;
  connectsSpent: number | null;
  notes: string;
  proposalText: string;
  bidAmount: number | null;
  submittedVia: 'manual' | 'api' | 'simulated';
  appliedAt: string;
  updatedAt: string;
  job: { id: string; title: string; url: string; budgetLabel: string };
  applier: ApplierRef;
  account: AccountRef;
};
export type ApplicationList = {
  items: Application[];
  counts: Record<'all' | AppStatus, number>;
  connectsTotal: number;
};
export type ApplicationPatch = { status?: AppStatus; notes?: string; connectsSpent?: number | null };

// Home
export type Overview = {
  pendingDrafts: number;
  queue: { queued: number; failed: number };
  jobsCheckedLast24h: number;
  topDrafts: {
    id: string;
    score: number;
    title: string;
    budgetLabel: string;
    postedAt: string | null;
    applier: ApplierRef;
    account: AccountRef;
  }[];
  week: { sent: number; sentByApp: number; connects: number; byStatus: Record<AppStatus, number> };
  appliers: {
    id: string;
    name: string;
    active: boolean;
    lastRunAt: string | null;
    pendingDrafts: number;
    account: AccountRef;
  }[];
  accounts: { id: string; name: string; status: AccountStatus }[];
  setup: { hasAccount: boolean; hasProvider: boolean; hasApplier: boolean; hasTelegram: boolean };
};
