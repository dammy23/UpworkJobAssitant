import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api/client';
import { qk, useAccounts, useAppliers, useProviders } from '../api/queries';
import type { Account, ApplierSummary, Provider, RunSummary } from '../api/types';
import { Avatar, Empty, ErrorState, Icon, Loading, Switch } from '../components/ui';
import { money, plural, relTime } from '../lib/format';
import { usePageTitle, useTick } from '../lib/hooks';

export function accountStatusLabel(a: Pick<Account, 'status'>): { label: string; cls: string } {
  if (a.status === 'connected') return { label: 'Connected', cls: 'good' };
  if (a.status === 'sample') return { label: 'Waiting for API approval', cls: 'wait' };
  return { label: 'Needs attention', cls: 'bad' };
}

function looksFor(a: ApplierSummary): string {
  const what = [...a.roles, ...a.keywords].slice(0, 3);
  const parts: string[] = [];
  if (what.length) parts.push(what.join(', '));
  const pay: string[] = [];
  if (a.jobType !== 'hourly' && a.minFixedBudget) pay.push(`${money(a.minFixedBudget)} fixed`);
  if (a.jobType !== 'fixed' && a.minHourlyRate) pay.push(`${money(a.minHourlyRate)} an hour`);
  if (pay.length) parts.push('from ' + pay.join(' or '));
  if (a.clientPaymentVerified) parts.push('verified clients');
  return parts.length ? parts.join(', ').replace(/^./, (c) => c.toUpperCase()) : 'Any job on this account';
}

function modelTag(a: ApplierSummary, providers: Provider[] | undefined): string {
  if (!a.aiProvider) {
    const first = providers?.find((p) => p.enabled && p.configured);
    return first ? `AI: default (${first.name})` : 'AI: default';
  }
  const p = providers?.find((x) => x.id === a.aiProvider);
  return `AI: ${p?.name ?? a.aiProvider}`;
}

function runText(r: RunSummary): string {
  const parts = [
    `Checked ${plural(r.fetched, 'job')}`,
    r.alreadySeen ? `${r.alreadySeen} already seen` : '',
    r.filtered ? `${r.filtered} didn't match your rules` : '',
    r.belowThreshold ? `${r.belowThreshold} scored too low` : '',
  ].filter(Boolean);
  const drafted = r.drafted === 0 ? 'No new drafts.' : `${plural(r.drafted, 'new draft')} to review.`;
  return `${parts.join(', ')}. ${drafted}`;
}

function bar(n: number, max: number, color: string) {
  return { height: max > 0 ? Math.max(6, Math.round((n / max) * 40)) : 6, background: color };
}

function ApplierRow({ a, providers }: { a: ApplierSummary; providers: Provider[] | undefined }) {
  const qc = useQueryClient();
  const [run, setRun] = useState<{ ok: true; summary: RunSummary } | { ok: false; message: string } | null>(null);

  const toggle = useMutation({
    mutationFn: (active: boolean) => api.setApplierActive(a.id, active),
    onMutate: async (active) => {
      await qc.cancelQueries({ queryKey: qk.appliers });
      const prev = qc.getQueryData<ApplierSummary[]>(qk.appliers);
      qc.setQueryData<ApplierSummary[]>(qk.appliers, (old) => old?.map((x) => (x.id === a.id ? { ...x, active } : x)));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.appliers, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.appliers });
      void qc.invalidateQueries({ queryKey: qk.overview });
    },
  });

  const check = useMutation({
    mutationFn: () => api.runApplier(a.id),
    onMutate: () => setRun(null),
    onSuccess: (summary) => {
      setRun({ ok: true, summary });
      void qc.invalidateQueries({ queryKey: qk.appliers });
      void qc.invalidateQueries({ queryKey: qk.overview });
      void qc.invalidateQueries({ queryKey: qk.draftsAll });
    },
    onError: (e) => setRun({ ok: false, message: errorMessage(e) }),
  });

  const on = a.active;
  const s = a.stats7d;
  const max = Math.max(s.found, 1);
  return (
    <article className={on ? 'row' : 'row off'} aria-labelledby={`ap-${a.id}`}>
      <Switch on={on} onChange={(v) => toggle.mutate(v)} label={(on ? 'Pause ' : 'Turn on ') + a.name} disabled={toggle.isPending} />
      <div style={{ flex: '2 1 280px', minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px' }}>
          <Link id={`ap-${a.id}`} to={`/appliers/${a.id}`} style={{ font: "700 18px/1.25 'Bricolage Grotesque', sans-serif", textDecoration: 'none' }}>
            {a.name}
          </Link>
          <span className="mut" style={{ fontSize: 13.5 }}>
            {a.category ?? 'Any category'}
          </span>
        </div>
        <div style={{ fontSize: 14, color: '#2E4A45', marginTop: 6 }}>{looksFor(a)}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          <span className="tag">{a.materials.resume ? 'Resume added' : 'No resume'}</span>
          <span className="tag">{a.materials.video ? 'Intro video' : 'No video'}</span>
          <span className="tag">{a.materials.portfolioCount === 0 ? 'No past work' : plural(a.materials.portfolioCount, 'past project')}</span>
          <span className="tag">{modelTag(a, providers)}</span>
        </div>
        {toggle.isError && (
          <div className="field-err" role="alert">
            Couldn't {on ? 'turn it on' : 'pause it'}: {errorMessage(toggle.error)}.
          </div>
        )}
      </div>
      <div style={{ flex: '1 1 220px' }}>
        <div className="funnel" role="img" aria-label={`${s.found} found, ${s.passed} passed your rules, ${s.drafted} drafted in the last 7 days`}>
          <div className="fcol">
            <span className="fbar" style={{ height: 40, background: '#D5DDDA' }} />
            <span style={{ fontWeight: 700, fontSize: 15 }}>{s.found}</span>
            <span className="mut" style={{ fontSize: 12 }}>found</span>
          </div>
          <div className="fcol">
            <span className="fbar" style={bar(s.passed, max, '#9DB2AC')} />
            <span style={{ fontWeight: 700, fontSize: 15 }}>{s.passed}</span>
            <span className="mut" style={{ fontSize: 12 }}>passed rules</span>
          </div>
          <div className="fcol">
            <span className="fbar" style={bar(s.drafted, max, '#F2B632')} />
            <span style={{ fontWeight: 700, fontSize: 15 }}>{s.drafted}</span>
            <span className="mut" style={{ fontSize: 12 }}>drafted</span>
          </div>
        </div>
        <div className="mut" style={{ fontSize: 12.5, marginTop: 8 }}>Last 7 days</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flex: '0 0 auto' }}>
        <span className="mut" style={{ fontSize: 13 }}>
          {on ? (a.lastRunAt ? `Checked ${relTime(a.lastRunAt)}` : 'Not checked yet') : 'Paused'}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-s btn-q" onClick={() => check.mutate()} disabled={check.isPending}>
            {check.isPending ? (
              <>
                <span className="spinner" /> Checking…
              </>
            ) : (
              'Check now'
            )}
          </button>
          <Link className="btn btn-s" to={`/appliers/${a.id}`} aria-label={`Edit ${a.name}`}>
            Edit
          </Link>
        </div>
      </div>
      {run && (
        <div className={'run-note note ' + (run.ok && run.summary.errors.length === 0 ? 'note-ok' : run.ok ? '' : 'note-err')} role="status">
          {run.ok ? (
            <>
              {runText(run.summary)}
              {run.summary.drafted > 0 && (
                <>
                  {' '}
                  <Link to="/review">Review them</Link>.
                </>
              )}
              {run.summary.errors.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {run.summary.errors.map((e, i) => (
                    <li key={i} className="err-text">
                      {e}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>Couldn't check for jobs: {run.message}. Try again.</>
          )}
          <button type="button" className="linkbtn" style={{ marginLeft: 10 }} onClick={() => setRun(null)}>
            Dismiss
          </button>
        </div>
      )}
    </article>
  );
}

export function AppliersPage() {
  usePageTitle('Appliers');
  useTick();
  const appliers = useAppliers();
  const accounts = useAccounts();
  const providers = useProviders();

  const header = (
    <div className="top" style={{ marginBottom: 32 }}>
      <div>
        <h1 className="h1">Appliers</h1>
        <p className="sub" style={{ color: '#5A706B', maxWidth: '60ch' }}>
          Each applier watches for one kind of job on one Upwork account, and drafts replies in its own voice with its own resume.
        </p>
      </div>
      <Link className="btn btn-p" to="/appliers/new">
        <Icon.Plus />
        New applier
      </Link>
    </div>
  );

  if (appliers.isPending || accounts.isPending) return (<>{header}<Loading label="Loading appliers" /></>);
  if (appliers.isError) return (<>{header}<ErrorState what="appliers" error={appliers.error} onRetry={() => appliers.refetch()} /></>);
  if (accounts.isError) return (<>{header}<ErrorState what="accounts" error={accounts.error} onRetry={() => accounts.refetch()} /></>);

  const accs = accounts.data;
  const list = appliers.data;
  // Group by account; keep accounts with no appliers too so they're visible.
  const groups = accs.map((acc) => ({ acc, items: list.filter((a) => a.upworkAccountId === acc.id || a.account.id === acc.id) }));
  const orphan = list.filter((a) => !accs.some((acc) => acc.id === a.account.id));

  return (
    <>
      {header}

      {accs.length === 0 && (
        <div style={{ marginBottom: 24 }}>
          <Empty title="Add an Upwork account first">
            <p className="mut" style={{ margin: 0, lineHeight: 1.5 }}>
              Appliers search for jobs on an Upwork account. Add one in Settings, or follow the setup guide.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link className="btn btn-p" to="/setup">
                Open the setup guide
              </Link>
              <Link className="btn" to="/settings#accounts">
                Go to Settings
              </Link>
            </div>
          </Empty>
        </div>
      )}

      {groups.map(({ acc, items }) => {
        const st = accountStatusLabel(acc);
        return (
          <section key={acc.id} style={{ marginBottom: 36 }} aria-label={`${acc.name}'s appliers`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <Avatar id={acc.id} name={acc.name} size={36} />
              <div style={{ flex: '1 1 240px' }}>
                <h2 className="h2">{acc.name}'s Upwork account</h2>
                <div className="mut" style={{ fontSize: 13.5, marginTop: 4 }}>
                  {[acc.email, plural(items.length, 'applier')].filter(Boolean).join(', ')}
                </div>
              </div>
              <span className={'status ' + st.cls}>
                <i />
                {st.label}
              </span>
            </div>
            {acc.status === 'error' && acc.lastError && (
              <div className="note note-err" style={{ marginBottom: 12 }}>
                Last search failed: {acc.lastError}. <Link to="/settings#accounts">Check the keys in Settings</Link>.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.map((a) => (
                <ApplierRow key={a.id} a={a} providers={providers.data} />
              ))}
              {items.length === 0 && (
                <div className="row off" style={{ justifyContent: 'space-between' }}>
                  <span className="mut">No appliers on this account yet.</span>
                  <Link className="btn btn-s" to={`/appliers/new?account=${encodeURIComponent(acc.id)}`}>
                    Add one
                  </Link>
                </div>
              )}
            </div>
          </section>
        );
      })}

      {orphan.length > 0 && (
        <section style={{ marginBottom: 36 }} aria-label="Other appliers">
          <h2 className="h2" style={{ marginBottom: 14 }}>Other appliers</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {orphan.map((a) => (
              <ApplierRow key={a.id} a={a} providers={providers.data} />
            ))}
          </div>
        </section>
      )}

      <Link className="dashed" to="/settings#accounts">
        <Icon.PlusCircle />
        <span>
          <strong>Connect another Upwork account</strong>
          <br />
          <span className="mut" style={{ fontSize: 13.5 }}>
            For a teammate or someone you manage applications for. Upwork allows one freelancer account per person.
          </span>
        </span>
      </Link>
    </>
  );
}
