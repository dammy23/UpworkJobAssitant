import type {
  Account,
  AccountInput,
  Application,
  ApplicationList,
  ApplicationPatch,
  AppStatus,
  ApplierDetail,
  ApplierInput,
  ApplierSummary,
  Draft,
  DraftEdits,
  DraftSort,
  DraftState,
  FindChatResult,
  Material,
  MaterialPatch,
  Overview,
  PortfolioInput,
  Preview,
  Provider,
  ProviderId,
  ProviderPatch,
  RewriteInstruction,
  RunSummary,
  SkipReason,
  SubmitItem,
  SubmitResult,
  TelegramInput,
  TelegramSettings,
  Template,
  TestResult,
} from './types';

export const API_BASE = '/api';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type Query = Record<string, string | null | undefined>;

function buildUrl(path: string, query?: Query): string {
  let url = API_BASE + path;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, v);
    }
    const qs = params.toString();
    if (qs) url += '?' + qs;
  }
  return url;
}

async function request<T>(method: string, path: string, opts: { body?: unknown; form?: FormData; query?: Query } = {}): Promise<T> {
  const init: RequestInit = { method, headers: { Accept: 'application/json' } };
  if (opts.form) {
    init.body = opts.form;
  } else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), init);
  } catch {
    throw new ApiError(0, 'the server could not be reached');
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`.trim();
    try {
      const data = (await res.json()) as { error?: unknown };
      if (data && typeof data.error === 'string' && data.error) message = data.error;
    } catch {
      // body was not JSON; keep the status text
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const get = <T>(path: string, query?: Query) => request<T>('GET', path, { query });
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, { body });
const put = <T>(path: string, body: unknown) => request<T>('PUT', path, { body });
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, { body });
const del = (path: string) => request<void>('DELETE', path);
const upload = <T>(path: string, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return request<T>('POST', path, { form });
};

const enc = encodeURIComponent;

export const api = {
  // Accounts
  accounts: () => get<Account[]>('/accounts'),
  createAccount: (input: AccountInput) => post<Account>('/accounts', input),
  updateAccount: (id: string, input: Partial<AccountInput>) => patch<Account>(`/accounts/${enc(id)}`, input),
  deleteAccount: (id: string) => del(`/accounts/${enc(id)}`),
  disconnectAccount: (id: string) => post<Account>(`/accounts/${enc(id)}/upwork/disconnect`),

  // Providers
  providers: () => get<Provider[]>('/providers'),
  updateProvider: (id: ProviderId, input: ProviderPatch) => patch<Provider>(`/providers/${enc(id)}`, input),
  orderProviders: (order: ProviderId[]) => put<Provider[]>('/providers/order', { order }),
  testProvider: (id: ProviderId) => post<TestResult>(`/providers/${enc(id)}/test`),
  ollamaModels: (baseUrl: string) => get<{ models: string[] }>('/providers/ollama/models', { baseUrl }),

  // Telegram
  telegram: () => get<TelegramSettings>('/settings/telegram'),
  saveTelegram: (input: TelegramInput) => put<TelegramSettings>('/settings/telegram', input),
  findTelegramChat: () => post<FindChatResult>('/settings/telegram/find-chat'),
  testTelegram: () => post<TestResult>('/settings/telegram/test'),

  // Appliers
  appliers: () => get<ApplierSummary[]>('/appliers'),
  applier: (id: string) => get<ApplierDetail>(`/appliers/${enc(id)}`),
  createApplier: (input: ApplierInput) => post<ApplierDetail>('/appliers', input),
  updateApplier: (id: string, input: ApplierInput) => put<ApplierDetail>(`/appliers/${enc(id)}`, input),
  setApplierActive: (id: string, active: boolean) => patch<ApplierSummary>(`/appliers/${enc(id)}/active`, { active }),
  deleteApplier: (id: string) => del(`/appliers/${enc(id)}`),
  runApplier: (id: string) => post<RunSummary>(`/appliers/${enc(id)}/run`),
  previewApplier: (input: ApplierInput) => post<Preview>('/appliers/preview', input),
  templates: () => get<Template[]>('/templates'),

  // Materials
  uploadResume: (applierId: string, file: File) => upload<Material>(`/appliers/${enc(applierId)}/materials/resume`, file),
  uploadVideo: (applierId: string, file: File) => upload<Material>(`/appliers/${enc(applierId)}/materials/video`, file),
  linkVideo: (applierId: string, url: string) => post<Material>(`/appliers/${enc(applierId)}/materials/video`, { url }),
  addPortfolio: (applierId: string, input: PortfolioInput) =>
    post<Material>(`/appliers/${enc(applierId)}/materials/portfolio`, input),
  updateMaterial: (id: string, input: MaterialPatch) => patch<Material>(`/materials/${enc(id)}`, input),
  deleteMaterial: (id: string) => del(`/materials/${enc(id)}`),

  // Drafts
  drafts: (q: { accountId?: string; sort?: DraftSort; state?: Exclude<DraftState, 'sending'> }) => get<Draft[]>('/drafts', q),
  draft: (id: string) => get<Draft>(`/drafts/${enc(id)}`),
  updateDraft: (id: string, edits: DraftEdits) => patch<Draft>(`/drafts/${enc(id)}`, edits),
  generateAnswers: (id: string) => post<Draft>(`/drafts/${enc(id)}/answers/generate`),
  submitDrafts: (items: SubmitItem[]) => post<SubmitResult>('/drafts/submit', { items }),
  unqueueDraft: (id: string) => post<Draft>(`/drafts/${enc(id)}/unqueue`),
  rewriteDraft: (id: string, instruction: RewriteInstruction) => post<Draft>(`/drafts/${enc(id)}/rewrite`, { instruction }),
  markApplied: (id: string, input: { connectsSpent: number | null; proposalText: string; bidAmount?: number | null }) =>
    post<Application>(`/drafts/${enc(id)}/applied`, input),
  skipDraft: (id: string, reason: SkipReason) => post<void>(`/drafts/${enc(id)}/skip`, { reason }),

  // Applications
  applications: (q: { status?: AppStatus; accountId?: string; applierId?: string }) =>
    get<ApplicationList>('/applications', q),
  updateApplication: (id: string, input: ApplicationPatch) => patch<Application>(`/applications/${enc(id)}`, input),

  // Home
  overview: () => get<Overview>('/overview'),
};

export const upworkConnectUrl = (accountId: string) => `${API_BASE}/accounts/${enc(accountId)}/upwork/connect`;
export const applicationsCsvUrl = API_BASE + '/applications.csv';

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
