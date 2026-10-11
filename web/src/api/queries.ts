import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { AppStatus, DraftSort } from './types';

export const qk = {
  overview: ['overview'] as const,
  accounts: ['accounts'] as const,
  providers: ['providers'] as const,
  telegram: ['telegram'] as const,
  appliers: ['appliers'] as const,
  applier: (id: string) => ['applier', id] as const,
  templates: ['templates'] as const,
  drafts: (accountId: string, sort: DraftSort) => ['drafts', accountId, sort] as const,
  draftsAll: ['drafts'] as const,
  applications: (status: string, accountId: string, applierId: string) =>
    ['applications', status, accountId, applierId] as const,
  applicationsAll: ['applications'] as const,
};

export const useOverview = () => useQuery({ queryKey: qk.overview, queryFn: api.overview, refetchInterval: 60_000 });
export const useAccounts = () => useQuery({ queryKey: qk.accounts, queryFn: api.accounts });
export const useProviders = () => useQuery({ queryKey: qk.providers, queryFn: api.providers });
export const useTelegram = () => useQuery({ queryKey: qk.telegram, queryFn: api.telegram });
export const useAppliers = () => useQuery({ queryKey: qk.appliers, queryFn: api.appliers });
export const useTemplates = () => useQuery({ queryKey: qk.templates, queryFn: api.templates, staleTime: 5 * 60_000 });
export const useApplier = (id: string | undefined) =>
  useQuery({ queryKey: qk.applier(id ?? ''), queryFn: () => api.applier(id as string), enabled: Boolean(id) });
/** All open drafts (ready, queued, sending, failed). Polls every 10s while any are queued or sending. */
export const useDrafts = (accountId: string, sort: DraftSort) =>
  useQuery({
    queryKey: qk.drafts(accountId, sort),
    queryFn: () => api.drafts({ accountId: accountId || undefined, sort }),
    refetchInterval: (query) => (query.state.data?.some((d) => d.state === 'queued' || d.state === 'sending') ? 10_000 : false),
  });
export const useApplications = (status: AppStatus | '', accountId: string, applierId: string) =>
  useQuery({
    queryKey: qk.applications(status, accountId, applierId),
    queryFn: () =>
      api.applications({
        status: status || undefined,
        accountId: accountId || undefined,
        applierId: applierId || undefined,
      }),
  });

/** Invalidate the things that change when drafts, appliers or applications move. */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: (readonly unknown[])[]) => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
}
