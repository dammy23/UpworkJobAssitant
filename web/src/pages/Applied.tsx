import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, applicationsCsvUrl, errorMessage } from '../api/client';
import { qk, useAccounts, useApplications, useAppliers } from '../api/queries';
import type { Application, ApplicationList, AppStatus } from '../api/types';
import { Avatar, Empty, ErrorState, Icon, Loading } from '../components/ui';
import { STATUS_COLOR, STATUS_LABEL, STATUS_ORDER, changeDate, money, plural, shortDate } from '../lib/format';
import { usePageTitle } from '../lib/hooks';

type Filter = 'all' | AppStatus;

const SENT_BY: Record<Application['submittedVia'], string> = { manual: 'You, on Upwork', api: 'The app', simulated: 'Test send' };
function SentBy({ a }: { a: Application }) {
  return <span className={a.submittedVia === 'simulated' ? 'mut' : undefined}>{SENT_BY[a.submittedVia]}</span>;
}

function summary(list: ApplicationList): string {
  const c = list.counts;
  if (c.all === 0) return 'Nothing sent yet. Proposals sent from Review show up here.';
  const oldest = list.items.reduce<string | null>((m, a) => (!m || a.appliedAt < m ? a.appliedAt : m), null);
  const since = oldest ? ` since ${shortDate(oldest)}` : '';
  const hired = c.hired ?? 0;
  const contract = hired === 0 ? '' : hired === 1 ? ' One became a contract.' : ` ${hired} became contracts.`;
  return `${plural(c.all, 'proposal')}${since}, ${list.connectsTotal} Connects spent.${contract}`;
}

function insight(list: ApplicationList): string {
  const c = list.counts;
  if (c.all === 0) return 'Update a job\'s status when the client gets in touch, so your appliers learn which jobs are worth it.';
  const replied = (c.replied ?? 0) + (c.interview ?? 0) + (c.hired ?? 0);
  const pct = Math.round((replied / c.all) * 100);
  const lead = replied === 0 ? 'No replies yet.' : `${pct}% of your proposals got a reply.`;
  return `${lead} Update a job's status when the client gets in touch, so your appliers learn which jobs are worth it.`;
}

/** Shared state and pieces for one application, used by the table row and the phone card. */
function useRowParts(a: Application) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(a.notes);
  useEffect(() => setNotes(a.notes), [a.notes]);
  const m = useMutation({
    mutationFn: (input: { status?: AppStatus; notes?: string }) => api.updateApplication(a.id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.applicationsAll });
      void qc.invalidateQueries({ queryKey: qk.overview });
    },
  });
  const pill = (
    <span className={'pill st-' + a.status}>
      <span className="dot" />
      {STATUS_LABEL[a.status]}
    </span>
  );

  const detail = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, paddingTop: 16 }}>
      <div style={{ flex: '2 1 380px', minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', fontSize: 14, marginBottom: 12 }}>
          <span>
            <span className="mut">Bid </span>
            <strong>{a.bidAmount ? money(a.bidAmount) : 'Not recorded'}</strong>
          </span>
          <span>
            <span className="mut">How it was sent: </span>
            <strong>
              <SentBy a={a} />
            </strong>
          </span>
        </div>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>What was sent</div>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, whiteSpace: 'pre-line', maxWidth: '70ch' }}>{a.proposalText || 'No text was saved with this one.'}</p>
      </div>
      <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label htmlFor={'st-' + a.id} className="lbl">
            Status
          </label>
          <select className="sel" id={'st-' + a.id} style={{ width: '100%' }} value={a.status} disabled={m.isPending} onChange={(e) => m.mutate({ status: e.target.value as AppStatus })}>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={'nt-' + a.id} className="lbl">
            Notes
          </label>
          <textarea
            id={'nt-' + a.id}
            className="in"
            rows={3}
            style={{ fontSize: 14 }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== a.notes) m.mutate({ notes });
            }}
          />
          <div className="hint" aria-live="polite">
            {m.isPending ? 'Saving…' : m.isError ? <span className="err-text">Couldn't save: {errorMessage(m.error)}.</span> : m.isSuccess ? 'Saved' : 'Saved when you click away.'}
          </div>
        </div>
        <a className="btn btn-s" href={a.job.url} target="_blank" rel="noopener noreferrer" style={{ alignSelf: 'flex-start' }}>
          Open job on Upwork <Icon.External />
        </a>
      </div>
    </div>
  );

  return { pill, detail };
}

function TableRow({ a, open, onToggle }: { a: Application; open: boolean; onToggle: () => void }) {
  const { pill, detail } = useRowParts(a);
  return (
    <Fragment>
      <tr style={open ? { background: '#F7F9F8' } : undefined}>
        <td className="td">
          <button type="button" className="rowbtn" onClick={onToggle} aria-expanded={open} aria-controls={'d-' + a.id}>
            <Icon.Next size={16} className="chev" />
            <span>
              {a.job.title}
              <span className="mut" style={{ display: 'block', fontWeight: 500, fontSize: 13, marginTop: 3 }}>
                {a.applier.name}
              </span>
            </span>
          </button>
        </td>
        <td className="td">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Avatar id={a.account.id} name={a.account.name} size={24} />
            {a.account.name}
          </span>
        </td>
        <td className="td" style={{ whiteSpace: 'nowrap', fontSize: 14 }}>
          <SentBy a={a} />
        </td>
        <td className="td" style={{ whiteSpace: 'nowrap' }}>
          {shortDate(a.appliedAt)}
        </td>
        <td className="td" style={{ textAlign: 'right' }}>
          {a.connectsSpent ?? '–'}
        </td>
        <td className="td">{pill}</td>
        <td className="td mut" style={{ whiteSpace: 'nowrap', fontSize: 13.5 }}>
          {changeDate(a.updatedAt)}
        </td>
      </tr>
      {open && (
        <tr id={'d-' + a.id}>
          <td colSpan={7} style={{ padding: '0 16px 20px 42px', borderBottom: '1px solid #E4EAE8', background: '#F7F9F8' }}>
            {detail}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function CardRow({ a, open, onToggle }: { a: Application; open: boolean; onToggle: () => void }) {
  const { pill, detail } = useRowParts(a);
  return (
    <div className="mcard">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={'m-' + a.id} style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <strong style={{ fontSize: 15, lineHeight: 1.35 }}>{a.job.title}</strong>
          {pill}
        </div>
        <div style={{ fontSize: 13, color: '#5A706B', marginTop: 6 }}>
          {a.account.name}, {a.applier.name}. Sent {shortDate(a.appliedAt)} {a.submittedVia === 'manual' ? 'by you on Upwork' : a.submittedVia === 'api' ? 'by the app' : '(test send)'}
        </div>
        {a.notes && !open && <div style={{ fontSize: 13, marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#F7F9F8' }}>{a.notes}</div>}
      </button>
      {open && <div id={'m-' + a.id}>{detail}</div>}
    </div>
  );
}

export function AppliedPage() {
  usePageTitle('Applied jobs');
  const [filter, setFilter] = useState<Filter>('all');
  const [accountId, setAccountId] = useState('');
  const [applierId, setApplierId] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const accounts = useAccounts();
  const appliers = useAppliers();
  // Fetch unfiltered by status once for the pipeline, and filtered for the table.
  const all = useApplications('', accountId, applierId);
  const filtered = useApplications(filter === 'all' ? '' : filter, accountId, applierId);

  const list = filter === 'all' ? all.data : filtered.data;
  const counts = all.data?.counts ?? filtered.data?.counts;
  const total = counts?.all ?? 0;

  const header = (
    <div className="top">
      <div>
        <h1 className="h1">Applied jobs</h1>
        <p className="sub" style={{ color: '#5A706B' }}>
          {all.data ? summary(all.data) : ' '}
        </p>
      </div>
      <a className="btn" href={applicationsCsvUrl} download>
        <Icon.Download />
        Download as CSV
      </a>
    </div>
  );

  if (all.isPending) return (<>{header}<Loading label="Loading applied jobs" /></>);
  if (all.isError) return (<>{header}<ErrorState what="applied jobs" error={all.error} onRetry={() => all.refetch()} /></>);

  const nonZero = STATUS_ORDER.filter((s) => (counts?.[s] ?? 0) > 0);
  const pipelineCols = total > 0 ? nonZero.map((s) => `${Math.max(1, counts?.[s] ?? 0)}fr`).join(' ') : '1fr';
  const pipelineLabel =
    total === 0 ? 'No proposals yet' : `Of ${total} proposals: ` + nonZero.map((s) => `${counts?.[s]} ${s === 'applied' ? 'sent with no reply' : STATUS_LABEL[s].toLowerCase()}`).join(', ');

  const filters: Filter[] = ['all', ...STATUS_ORDER];
  const items = list?.items ?? [];

  return (
    <>
      {header}

      <section aria-label="Where your proposals are" className="box" style={{ padding: '22px 24px', marginBottom: 24 }}>
        {total === 0 ? (
          <div className="bar" aria-hidden="true" />
        ) : (
          <div className="stage-grid" style={{ gridTemplateColumns: pipelineCols }} role="img" aria-label={pipelineLabel}>
            {nonZero.map((s) => (
              <div className="stage" key={s}>
                <span className="sbar" style={{ background: STATUS_COLOR[s] }} />
                <span style={{ fontWeight: 700, fontSize: 18 }}>{counts?.[s]}</span>
                <span className="mut" style={{ fontSize: 13 }}>
                  {STATUS_LABEL[s]}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="mut" style={{ margin: '16px 0 0', fontSize: 13.5 }}>
          {insight(all.data)}
        </p>
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div role="group" aria-label="Filter by status" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {filters.map((k) => (
            <button key={k} type="button" className={filter === k ? 'fp on' : 'fp'} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {k === 'all' ? 'All' : STATUS_LABEL[k]}
              <span className="n">{counts?.[k] ?? 0}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label htmlFor="f-acct" className="sr-only">
            Account
          </label>
          <select className="sel" id="f-acct" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">All accounts</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <label htmlFor="f-app" className="sr-only">
            Applier
          </label>
          <select className="sel" id="f-app" value={applierId} onChange={(e) => setApplierId(e.target.value)}>
            <option value="">All appliers</option>
            {(appliers.data ?? [])
              .filter((a) => !accountId || a.account.id === accountId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      {filter !== 'all' && filtered.isError ? (
        <ErrorState what="applied jobs" error={filtered.error} onRetry={() => filtered.refetch()} />
      ) : filter !== 'all' && filtered.isPending ? (
        <Loading label="Loading applied jobs" />
      ) : items.length === 0 ? (
        <Empty title={total === 0 ? 'No applied jobs yet' : 'Nothing matches these filters'}>
          <p className="mut" style={{ margin: 0, lineHeight: 1.5 }}>
            {total === 0
              ? 'Proposals the app sends for you appear here. If you send one yourself on Upwork, use "Already sent it yourself?" in Review so it is saved here too.'
              : 'Try another status, account or applier.'}
          </p>
        </Empty>
      ) : (
        <>
          <div className="box app-table" style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th className="th" scope="col">Job</th>
                  <th className="th" scope="col">Account</th>
                  <th className="th" scope="col">Sent by</th>
                  <th className="th" scope="col">Sent</th>
                  <th className="th" scope="col" style={{ textAlign: 'right' }}>Connects</th>
                  <th className="th" scope="col">Status</th>
                  <th className="th" scope="col">Last change</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <TableRow key={a.id} a={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="app-cards">
            {items.map((a) => (
              <CardRow key={a.id} a={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} />
            ))}
          </div>
          <p className="mut" style={{ fontSize: 13, margin: '12px 4px 0' }}>
            Showing {items.length} of {total}
          </p>
        </>
      )}
    </>
  );
}
