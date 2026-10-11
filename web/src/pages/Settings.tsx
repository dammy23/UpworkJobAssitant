import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, applicationsCsvUrl, errorMessage, upworkConnectUrl } from '../api/client';
import { qk, useAccounts, useProviders, useTelegram } from '../api/queries';
import type { Account, AccountInput, Provider, ProviderId, ProviderPatch } from '../api/types';
import { Avatar, ErrorState, Icon, Loading, Switch } from '../components/ui';
import { numOrNull, plural, relTime, shortDate } from '../lib/format';
import { usePageTitle, useTick } from '../lib/hooks';

/* ---------------- Shared ---------------- */

type Msg = { tone: 'ok' | 'err' | 'info'; text: string } | null;
function MsgLine({ msg }: { msg: Msg }) {
  if (!msg) return null;
  const cls = msg.tone === 'ok' ? 'ok' : msg.tone === 'err' ? 'err-text' : 'mut';
  return (
    <span className={cls} style={{ fontSize: 13.5 }} role={msg.tone === 'err' ? 'alert' : 'status'}>
      {msg.text}
    </span>
  );
}

export const PROVIDER_LOOK: Record<ProviderId, { mono: string; bg: string; fg: string; keyPlaceholder: string; keyHint: string; summary: string; modelHint: string }> = {
  groq: { mono: 'G', bg: '#F3E1D7', fg: '#7A3418', keyPlaceholder: 'gsk_…', keyHint: 'From console.groq.com. Free, no card needed.', summary: 'Free tier, fast.', modelHint: '30 requests a minute on the free tier.' },
  claude: { mono: 'C', bg: '#ECE3D6', fg: '#5A3B12', keyPlaceholder: 'sk-ant-…', keyHint: 'From console.anthropic.com.', summary: 'Anthropic API, best for writing quality. Paid per use.', modelHint: 'Haiku is cheapest for scoring; Sonnet writes better replies.' },
  openai: { mono: 'O', bg: '#E3ECE9', fg: '#12302B', keyPlaceholder: 'sk-…', keyHint: 'From platform.openai.com. Paid per use.', summary: 'Paid per use.', modelHint: 'Smaller models are cheaper and fast enough for scoring.' },
  ollama: { mono: 'Ol', bg: '#E6E3FA', fg: '#3B2F9A', keyPlaceholder: 'http://localhost:11434', keyHint: 'The machine running this app must be able to reach it.', summary: 'Runs on your own computer. Free and private.', modelHint: 'Press Find models to list what your Ollama server has.' },
};

function accountState(a: Account): { cls: string; label: string } {
  if (a.status === 'connected') return { cls: 'state good', label: 'Signed in to Upwork' };
  if (a.status === 'sample') return { cls: 'state wait', label: a.canConnect ? 'Not signed in yet' : 'Using sample jobs' };
  return { cls: 'state bad', label: 'Needs attention' };
}

function accountDetail(a: Account): string {
  const parts = [a.email, plural(a.applierCount, 'applier')].filter(Boolean);
  if (a.status === 'sample') parts.push('sample jobs and test sends for now');
  else if (a.lastSearchAt) parts.push(`last search ${relTime(a.lastSearchAt)}`);
  return parts.join(', ');
}

function timeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === new Date().toDateString() ? hm : `${shortDate(iso)}, ${hm}`;
}

function usageLine(a: Account): string {
  const u = a.usage;
  const budget = a.limits.weeklyConnectsBudget;
  return `${u.sentToday} sent today · ${u.connectsThisWeek}${budget !== null ? ` of ${budget}` : ''} Connects this week`;
}

export const CALLBACK_URL = 'http://localhost:4000/api/upwork/callback';

/* ---------------- Accounts ---------------- */

type SecretKey = 'clientId' | 'clientSecret' | 'accessToken' | 'refreshToken';
const SECRET_FIELDS: { key: SecretKey; label: string; hint?: string; advanced?: boolean }[] = [
  { key: 'clientId', label: 'Client ID', hint: 'Shown as the key on your API key page.' },
  { key: 'clientSecret', label: 'Client secret', hint: 'Shown as the secret on the same page.' },
  { key: 'accessToken', label: 'Access token', hint: 'Only if you already have one. Connect with Upwork fills this in for you.', advanced: true },
  { key: 'refreshToken', label: 'Refresh token', advanced: true },
];

export function AccountForm({
  account,
  onDone,
  onCancel,
  submitLabel,
}: {
  account: Account | null;
  onDone: (a: Account) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(account?.name ?? '');
  const [email, setEmail] = useState(account?.email ?? '');
  const [secrets, setSecrets] = useState<Record<SecretKey, string>>({ clientId: '', clientSecret: '', accessToken: '', refreshToken: '' });
  const [clear, setClear] = useState<Record<SecretKey, boolean>>({ clientId: false, clientSecret: false, accessToken: false, refreshToken: false });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const idp = account ? 'acc-' + account.id : 'acc-new';

  const [advanced, setAdvanced] = useState(false);

  // The API only says whether each secret exists, never its value.
  const present = (k: SecretKey): boolean => {
    if (!account) return false;
    if (k === 'clientId') return account.hasClientId;
    if (k === 'clientSecret') return account.hasClientSecret;
    return account.hasAccessToken;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    const body: Partial<AccountInput> = { name: name.trim(), email: email.trim() };
    for (const f of SECRET_FIELDS) {
      const v = secrets[f.key].trim();
      if (v) body[f.key] = v;
      else if (clear[f.key]) body[f.key] = '';
    }
    try {
      const saved = account ? await api.updateAccount(account.id, body) : await api.createAccount(body as AccountInput);
      await Promise.all([qc.invalidateQueries({ queryKey: qk.accounts }), qc.invalidateQueries({ queryKey: qk.overview }), qc.invalidateQueries({ queryKey: qk.appliers })]);
      onDone(saved);
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  const nameErr = tried && !name.trim();
  const secretField = (f: (typeof SECRET_FIELDS)[number]) => {
          const has = present(f.key) && !clear[f.key];
          return (
            <div key={f.key}>
              <label className="lbl" htmlFor={idp + '-' + f.key}>
                {f.label}
              </label>
              <input
                className="in"
                id={idp + '-' + f.key}
                type="password"
                autoComplete="off"
                value={secrets[f.key]}
                placeholder={has ? 'Saved. Type to replace it.' : clear[f.key] ? 'Will be cleared' : ''}
                onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))}
                aria-describedby={idp + '-' + f.key + '-h'}
              />
              <div className="hint" id={idp + '-' + f.key + '-h'}>
                {f.hint}
                {present(f.key) && !secrets[f.key] && (
                  <>
                    {f.hint ? ' ' : ''}
                    <button type="button" className="linkbtn" style={{ fontSize: 13 }} onClick={() => setClear((c) => ({ ...c, [f.key]: !c[f.key] }))}>
                      {clear[f.key] ? 'Keep it' : 'Clear it'}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        };

  return (
    <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="grid2">
        <div>
          <label className="lbl" htmlFor={idp + '-name'}>
            Whose account is it?
          </label>
          <input
            className="in"
            id={idp + '-name'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={nameErr}
            aria-describedby={nameErr ? idp + '-name-e' : undefined}
            autoComplete="off"
          />
          {nameErr && (
            <div className="field-err" id={idp + '-name-e'}>
              Add a name, such as the person's first name.
            </div>
          )}
        </div>
        <div>
          <label className="lbl" htmlFor={idp + '-email'}>
            Upwork email
          </label>
          <input className="in" id={idp + '-email'} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <div className="note small" style={{ lineHeight: 1.55 }}>
        The client ID and secret come from your Upwork API key: on upwork.com/developer, open your key and copy its key and secret. The key's Callback URL must be{' '}
        <code style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{CALLBACK_URL}</code>, so Upwork can send you back here after you sign in.
      </div>
      <div className="grid2">
        {SECRET_FIELDS.filter((f) => !f.advanced).map(secretField)}
      </div>
      <div>
        <button type="button" className="linkbtn" style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }} aria-expanded={advanced} aria-controls={idp + '-adv'} onClick={() => setAdvanced((v) => !v)}>
          <Icon.Next size={14} className="chev" />
          Advanced
        </button>
        {advanced && (
          <div id={idp + '-adv'} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p className="mut" style={{ margin: 0, fontSize: 13.5 }}>
              Paste tokens by hand only if you can't use Connect with Upwork.
            </p>
            <div className="grid2">{SECRET_FIELDS.filter((f) => f.advanced).map(secretField)}</div>
          </div>
        )}
      </div>
      <p className="mut" style={{ margin: 0, fontSize: 13 }}>
        Keys are stored on this computer and never shown again. Leave a field empty to keep what is saved.
      </p>
      {err && (
        <div className="note note-err" role="alert">
          Couldn't save the account: {err}.
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button type="submit" className="btn btn-p btn-s" disabled={busy}>
          {busy ? <span className="spinner" /> : null}
          {submitLabel ?? (account ? 'Save' : 'Add account')}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-s btn-q" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}


/* ---------------- Sending limits ---------------- */

const GAP_MINUTES = [1, 2, 3, 5, 10, 15, 30];

function LimitsForm({ account }: { account: Account }) {
  const qc = useQueryClient();
  const idp = 'lim-' + account.id;
  const [cap, setCap] = useState(String(account.limits.dailyProposalCap));
  const [gap, setGap] = useState(account.limits.minGapSeconds);
  const [budget, setBudget] = useState(account.limits.weeklyConnectsBudget === null ? '' : String(account.limits.weeklyConnectsBudget));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const capNum = numOrNull(cap);
  const capErr = capNum === null || !Number.isInteger(capNum) || capNum < 1 || capNum > 50;
  const gapOptions = GAP_MINUTES.map((m) => m * 60);
  if (!gapOptions.includes(gap)) gapOptions.push(gap);
  gapOptions.sort((a, b) => a - b);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (capErr) {
      setMsg({ tone: 'err', text: 'Most proposals a day must be a whole number from 1 to 50.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api.updateAccount(account.id, { dailyProposalCap: capNum, minGapSeconds: gap, weeklyConnectsBudget: numOrNull(budget) });
      await Promise.all([qc.invalidateQueries({ queryKey: qk.accounts }), qc.invalidateQueries({ queryKey: qk.draftsAll })]);
      setMsg({ tone: 'ok', text: 'Limits saved.' });
    } catch (err) {
      setMsg({ tone: 'err', text: `Couldn't save the limits: ${errorMessage(err)}.` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate aria-labelledby={idp + '-h'} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h4 className="h3" id={idp + '-h'} style={{ fontSize: 16 }}>
          Sending limits
        </h4>
        <p className="mut" style={{ margin: '4px 0 0', fontSize: 13.5, lineHeight: 1.5 }}>
          Approved proposals are sent one at a time from this account, within these limits.
        </p>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div>
          <label className="lbl" htmlFor={idp + '-cap'}>
            Most proposals a day
          </label>
          <input
            className="in"
            id={idp + '-cap'}
            type="number"
            min={1}
            max={50}
            step={1}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            aria-invalid={capErr}
            aria-describedby={idp + '-cap-h'}
          />
          <div className={capErr ? 'field-err' : 'hint'} id={idp + '-cap-h'}>
            From 1 to 50.
          </div>
        </div>
        <div>
          <label className="lbl" htmlFor={idp + '-gap'}>
            Minimum gap between sends
          </label>
          <select className="sel" id={idp + '-gap'} style={{ width: '100%', minHeight: 44 }} value={gap} onChange={(e) => setGap(Number(e.target.value))}>
            {gapOptions.map((sec) => (
              <option key={sec} value={sec}>
                {sec % 60 === 0 ? plural(sec / 60, 'minute') : plural(sec, 'second')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl" htmlFor={idp + '-budget'}>
            Weekly Connects budget
          </label>
          <input
            className="in"
            id={idp + '-budget'}
            inputMode="numeric"
            value={budget}
            onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ''))}
            aria-describedby={idp + '-budget-h'}
          />
          <div className="hint" id={idp + '-budget-h'}>
            Leave empty for no budget.
          </div>
        </div>
      </div>
      <div className="mut" style={{ fontSize: 13.5 }}>
        {usageLine(account)}
        {account.usage.nextSendAt && ` · Next send after ${timeOfDay(account.usage.nextSendAt)}`}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <button type="submit" className="btn btn-p btn-s" disabled={busy}>
          {busy ? <span className="spinner" /> : null}
          Save limits
        </button>
        <MsgLine msg={msg} />
      </div>
    </form>
  );
}

function AccountsSection({ highlightNew, connectedId, upworkError, onDismissNotice }: { highlightNew: boolean; connectedId: string | null; upworkError: string | null; onDismissNotice: () => void }) {
  useTick();
  const qc = useQueryClient();
  const q = useAccounts();
  const [editing, setEditing] = useState<string | null>(highlightNew ? 'new' : null);
  const [msg, setMsg] = useState<Msg>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const disconnect = async (a: Account) => {
    if (!window.confirm(`Disconnect ${a.name}'s Upwork account? The app stops sending from it and goes back to sample jobs and test sends until you connect again.`)) return;
    setDisconnecting(a.id);
    setMsg(null);
    try {
      await api.disconnectAccount(a.id);
      await Promise.all([qc.invalidateQueries({ queryKey: qk.accounts }), qc.invalidateQueries({ queryKey: qk.overview }), qc.invalidateQueries({ queryKey: qk.draftsAll })]);
      setMsg({ tone: 'ok', text: `${a.name}'s Upwork account was disconnected.` });
    } catch (e) {
      setMsg({ tone: 'err', text: `Couldn't disconnect it: ${errorMessage(e)}.` });
    } finally {
      setDisconnecting(null);
    }
  };
  const connectedName = connectedId ? (q.data?.find((a) => a.id === connectedId)?.name ?? null) : null;

  const remove = async (a: Account) => {
    if (!window.confirm(`Remove ${a.name}'s Upwork account? Its saved keys are deleted.`)) return;
    setDeleting(a.id);
    setMsg(null);
    try {
      await api.deleteAccount(a.id);
      await Promise.all([qc.invalidateQueries({ queryKey: qk.accounts }), qc.invalidateQueries({ queryKey: qk.overview })]);
      setEditing(null);
      setMsg({ tone: 'ok', text: `${a.name}'s account was removed.` });
    } catch (e) {
      const text = (e as { status?: number }).status === 409 ? `${a.name}'s account still has appliers. Delete or move them first.` : `Couldn't remove it: ${errorMessage(e)}.`;
      setMsg({ tone: 'err', text });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <section id="accounts" aria-labelledby="h-acc" style={{ display: 'flex', flexDirection: 'column', gap: 16, scrollMarginTop: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 className="h2" id="h-acc">Upwork accounts</h2>
          <p className="mut" style={{ margin: '6px 0 0', fontSize: 14.5, lineHeight: 1.5, maxWidth: '62ch' }}>
            Each account needs its own API key from upwork.com/developer. The app uses it to search for jobs and to send the proposals you approve, from that account. Upwork allows one
            freelancer account per person, so add accounts for teammates, not second profiles.
          </p>
        </div>
        <button type="button" className="btn btn-p" onClick={() => setEditing('new')} aria-expanded={editing === 'new'}>
          Connect an account
        </button>
      </div>
      {highlightNew && (
        <div className="note" role="status">
          Add an Upwork account first. Appliers search for jobs on an account.
        </div>
      )}
      {connectedId && (
        <div className="note note-ok" role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: '1 1 240px' }}>{connectedName ? `${connectedName}'s Upwork account is connected.` : 'The Upwork account is connected.'} Proposals you approve are now sent from it.</span>
          <button type="button" className="btn btn-q btn-s" onClick={onDismissNotice}>
            Dismiss
          </button>
        </div>
      )}
      {upworkError && (
        <div className="note note-err" role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: '1 1 240px' }}>Couldn't connect to Upwork: {upworkError}</span>
          <button type="button" className="btn btn-q btn-s" onClick={onDismissNotice}>
            Dismiss
          </button>
        </div>
      )}
      <MsgLine msg={msg} />
      {q.isPending ? (
        <Loading label="Loading accounts" />
      ) : q.isError ? (
        <ErrorState what="accounts" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="box">
          {editing === 'new' && (
            <div className="line" style={{ display: 'block' }}>
              <h3 className="h3" style={{ marginBottom: 14 }}>Connect an account</h3>
              <AccountForm
                account={null}
                onCancel={() => setEditing(null)}
                onDone={(a) => {
                  setEditing(null);
                  setMsg({ tone: 'ok', text: `${a.name}'s account was added.` });
                }}
              />
            </div>
          )}
          {q.data.length === 0 && editing !== 'new' && (
            <div className="line">
              <span className="mut">No accounts yet. Connect one to start finding jobs.</span>
            </div>
          )}
          {q.data.map((a) => {
            const st = accountState(a);
            const open = editing === a.id;
            return (
              <div key={a.id} className="line" style={{ display: 'block' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
                  <Avatar id={a.id} name={a.name} size={40} />
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15.5 }}>{a.name}</div>
                    <div className="mut" style={{ fontSize: 13.5, marginTop: 3 }}>
                      {accountDetail(a)}
                    </div>
                  </div>
                  <span className={st.cls}>
                    <i />
                    {st.label}
                  </span>
                  <button type="button" className="btn btn-s" aria-expanded={open} aria-controls={'acc-body-' + a.id} onClick={() => setEditing(open ? null : a.id)}>
                    {open ? 'Close' : 'Manage'}
                  </button>
                </div>
                <div className="acc-sub">
                  {a.status === 'connected' ? (
                    <>
                      <span style={{ flex: '1 1 260px' }}>
                        Signed in as <strong>{a.upworkUserName || a.name}</strong>
                        {a.connectedAt ? ` since ${shortDate(a.connectedAt)}` : ''}. Approved proposals are sent from this account.
                      </span>
                      <button type="button" className="btn btn-s btn-q btn-danger" onClick={() => disconnect(a)} disabled={disconnecting === a.id}>
                        {disconnecting === a.id ? <span className="spinner" /> : null}
                        Disconnect<span className="sr-only"> {a.name}'s Upwork account</span>
                      </button>
                    </>
                  ) : a.canConnect ? (
                    <>
                      <span style={{ flex: '1 1 260px' }}>Sign in to Upwork so the app can send approved proposals from {a.name}'s account. Until then, sends are test sends.</span>
                      <a className="btn btn-p btn-s" href={upworkConnectUrl(a.id)}>
                        Connect with Upwork<span className="sr-only">, {a.name}'s account</span>
                      </a>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: '1 1 260px' }}>Add the client ID and secret from your Upwork API key first. Until then, this account uses sample jobs and test sends.</span>
                      {!open && (
                        <button type="button" className="btn btn-s" onClick={() => setEditing(a.id)}>
                          Add the key
                        </button>
                      )}
                    </>
                  )}
                </div>
                {!open && (
                  <div className="acc-sub mut" style={{ fontSize: 13, marginTop: 8 }}>
                    {usageLine(a)}
                    {a.usage.nextSendAt && ` · Next send after ${timeOfDay(a.usage.nextSendAt)}`}
                  </div>
                )}
                {a.lastError && (
                  <div className="note note-err" style={{ marginTop: 12 }}>
                    Last search failed: {a.lastError}
                  </div>
                )}
                {open && (
                  <div id={'acc-body-' + a.id} style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
                    <LimitsForm account={a} />
                    <div style={{ borderTop: '1px solid #E4EAE8', paddingTop: 16 }}>
                      <h4 className="h3" style={{ fontSize: 16, marginBottom: 12 }}>
                        Name and API key
                      </h4>
                      {!a.canConnect && a.status !== 'connected' && (
                        <p className="warn" style={{ margin: '0 0 12px', fontSize: 13.5, fontWeight: 600 }}>
                          Add the client ID and secret from your Upwork API key first.
                        </p>
                      )}
                    <AccountForm
                      account={a}
                      onCancel={() => setEditing(null)}
                      onDone={(s) => {
                        setEditing(null);
                        setMsg({ tone: 'ok', text: `${s.name}'s account was saved.` });
                      }}
                    />
                    </div>
                    <div style={{ borderTop: '1px solid #E4EAE8', paddingTop: 14 }}>
                      <button type="button" className="btn btn-s btn-q btn-danger" onClick={() => remove(a)} disabled={deleting === a.id}>
                        {deleting === a.id ? <span className="spinner" /> : null}
                        Remove this account
                      </button>
                      {a.applierCount > 0 && (
                        <span className="hint" style={{ marginLeft: 8 }}>
                          It has {plural(a.applierCount, 'applier')}, which need to be deleted first.
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------------- Providers ---------------- */

function providerSummary(p: Provider): string {
  if (!p.configured) return 'Not connected';
  const look = PROVIDER_LOOK[p.id];
  return `${look.summary} ${p.model}`;
}

function testNote(p: Provider): string {
  if (!p.lastTestAt) return 'Not tested yet.';
  const when = relTime(p.lastTestAt);
  return p.lastTestOk ? `Last test passed ${when}.` : `Last test failed ${when}${p.lastTestMessage ? ': ' + p.lastTestMessage : ''}.`;
}

export function ProviderEditor({ p, onSaved }: { p: Provider; onSaved?: (p: Provider) => void }) {
  const qc = useQueryClient();
  const [secret, setSecret] = useState(p.needsBaseUrl ? (p.baseUrl ?? '') : '');
  const [model, setModel] = useState(p.model);
  const [found, setFound] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'find' | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const look = PROVIDER_LOOK[p.id];
  const keyId = 'key-' + p.id;
  const modelId = 'model-' + p.id;
  const listId = 'models-' + p.id;
  const models = Array.from(new Set([...(found ?? []), ...p.suggestedModels, p.model].filter(Boolean)));

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: qk.providers }), qc.invalidateQueries({ queryKey: qk.overview })]);

  const save = async (): Promise<boolean> => {
    setBusy('save');
    setMsg(null);
    const body: ProviderPatch = { model: model.trim() || p.model };
    if (p.needsBaseUrl) body.baseUrl = secret.trim();
    else if (secret.trim()) body.apiKey = secret.trim();
    if (!p.enabled && (secret.trim() || p.configured)) body.enabled = true;
    try {
      const saved = await api.updateProvider(p.id, body);
      await refresh();
      if (!p.needsBaseUrl) setSecret('');
      setMsg({ tone: 'ok', text: 'Saved.' });
      onSaved?.(saved);
      return true;
    } catch (e) {
      setMsg({ tone: 'err', text: `Couldn't save: ${errorMessage(e)}.` });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    const dirty = (p.needsBaseUrl ? secret.trim() !== (p.baseUrl ?? '') : Boolean(secret.trim())) || model.trim() !== p.model;
    if (dirty && !(await save())) return;
    setBusy('test');
    setMsg({ tone: 'info', text: 'Scoring a sample job…' });
    try {
      const r = await api.testProvider(p.id);
      setMsg({ tone: r.ok ? 'ok' : 'err', text: r.message || (r.ok ? 'It works.' : 'The test failed.') });
      await refresh();
    } catch (e) {
      setMsg({ tone: 'err', text: `Couldn't run the test: ${errorMessage(e)}.` });
    } finally {
      setBusy(null);
    }
  };

  const findModels = async () => {
    setBusy('find');
    setMsg(null);
    try {
      const r = await api.ollamaModels(secret.trim() || p.baseUrl || 'http://localhost:11434');
      setFound(r.models);
      setMsg(r.models.length ? { tone: 'ok', text: `Found ${plural(r.models.length, 'model')}.` } : { tone: 'err', text: 'The server has no models yet. Run "ollama pull qwen3:14b" first.' });
      if (r.models.length && !r.models.includes(model)) setModel(r.models[0]);
    } catch (e) {
      setMsg({ tone: 'err', text: `Couldn't reach Ollama: ${errorMessage(e)}.` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="grid2">
        <div>
          <label className="lbl" htmlFor={keyId}>
            {p.needsBaseUrl ? 'Server address' : 'API key'}
          </label>
          <input
            className="in"
            id={keyId}
            type={p.needsBaseUrl ? 'url' : 'password'}
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={p.needsBaseUrl ? look.keyPlaceholder : p.apiKeyHint ? `Saved (${p.apiKeyHint}). Type to replace it.` : look.keyPlaceholder}
            aria-describedby={keyId + '-h'}
          />
          <div className="hint" id={keyId + '-h'}>
            {look.keyHint}
          </div>
        </div>
        <div>
          <label className="lbl" htmlFor={modelId}>
            Model
          </label>
          <input className="in" id={modelId} list={listId} value={model} onChange={(e) => setModel(e.target.value)} aria-describedby={modelId + '-h'} autoComplete="off" />
          <datalist id={listId}>
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <div className="hint" id={modelId + '-h'}>
            Pick a suggestion or type any model name. {look.modelHint}
          </div>
          {models.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }} role="group" aria-label="Suggested models">
              {models.slice(0, 6).map((m) => (
                <button key={m} type="button" className="rw" aria-pressed={m === model} onClick={() => setModel(m)} style={m === model ? { borderColor: '#12302B', fontWeight: 600 } : undefined}>
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-s btn-p" onClick={() => void save()} disabled={busy !== null}>
          {busy === 'save' ? <span className="spinner" /> : null}
          Save
        </button>
        {p.id === 'ollama' && (
          <button type="button" className="btn btn-s" onClick={findModels} disabled={busy !== null}>
            {busy === 'find' ? <span className="spinner" /> : null}
            Find models
          </button>
        )}
        <button type="button" className="btn btn-s" onClick={test} disabled={busy !== null || (!p.configured && !secret.trim())}>
          {busy === 'test' ? <span className="spinner" /> : null}
          Test with a sample job
        </button>
        {msg ? <MsgLine msg={msg} /> : <span className="mut" style={{ fontSize: 13.5 }}>{testNote(p)}</span>}
      </div>
    </div>
  );
}

function ProvidersSection() {
  useTick();
  const qc = useQueryClient();
  const q = useProviders();
  const [open, setOpen] = useState<ProviderId | null>(null);
  const [toggling, setToggling] = useState<ProviderId | null>(null);
  const [orderBusy, setOrderBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const toggle = async (p: Provider, enabled: boolean) => {
    setToggling(p.id);
    setMsg(null);
    try {
      await api.updateProvider(p.id, { enabled });
      await Promise.all([qc.invalidateQueries({ queryKey: qk.providers }), qc.invalidateQueries({ queryKey: qk.overview })]);
    } catch (e) {
      setMsg({ tone: 'err', text: `Couldn't ${enabled ? 'turn on' : 'turn off'} ${p.name}: ${errorMessage(e)}.` });
    } finally {
      setToggling(null);
    }
  };

  const move = async (list: Provider[], i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const ids = list.map((p) => p.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    // Keep providers that aren't in the visible order list after the ones that are.
    const rest = (q.data ?? []).map((p) => p.id).filter((id) => !ids.includes(id));
    setOrderBusy(true);
    setMsg(null);
    try {
      const updated = await api.orderProviders([...ids, ...rest]);
      qc.setQueryData(qk.providers, updated);
    } catch (e) {
      setMsg({ tone: 'err', text: `Couldn't change the order: ${errorMessage(e)}.` });
    } finally {
      setOrderBusy(false);
    }
  };

  return (
    <section id="ai" aria-labelledby="h-ai" style={{ display: 'flex', flexDirection: 'column', gap: 16, scrollMarginTop: 16 }}>
      <div>
        <h2 className="h2" id="h-ai">AI providers</h2>
        <p className="mut" style={{ margin: '6px 0 0', fontSize: 14.5, lineHeight: 1.5, maxWidth: '62ch' }}>
          Connect the services that score jobs and write replies. Appliers use the default order below unless you pick a model for one.
        </p>
      </div>
      <MsgLine msg={msg} />
      {q.isPending ? (
        <Loading label="Loading AI providers" />
      ) : q.isError ? (
        <ErrorState what="AI providers" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="box">
            {q.data.map((p) => {
              const look = PROVIDER_LOOK[p.id];
              const isOpen = open === p.id;
              const connected = p.configured;
              const stateCls = !connected ? 'state off' : p.enabled ? (p.lastTestOk === false ? 'state wait' : 'state good') : 'state off';
              const stateLabel = !connected ? 'Not connected' : !p.enabled ? 'Turned off' : p.lastTestOk === false ? 'Last test failed' : 'Connected';
              return (
                <div key={p.id} style={{ borderBottom: '1px solid #E4EAE8' }}>
                  <div className="line" style={{ borderBottom: 0 }}>
                    <span className="logo" style={{ background: look.bg, color: look.fg }} aria-hidden="true">
                      {look.mono}
                    </span>
                    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15.5 }}>{p.name}</div>
                      <div className="mut" style={{ fontSize: 13.5, marginTop: 3 }}>
                        {providerSummary(p)}
                      </div>
                    </div>
                    <span className={stateCls}>
                      <i />
                      {stateLabel}
                    </span>
                    {connected && (
                      <Switch on={p.enabled} onChange={(v) => toggle(p, v)} label={(p.enabled ? 'Turn off ' : 'Turn on ') + p.name} disabled={toggling === p.id} />
                    )}
                    <button type="button" className="btn btn-s" aria-expanded={isOpen} aria-controls={'pv-' + p.id} onClick={() => setOpen(isOpen ? null : p.id)}>
                      {isOpen ? 'Close' : connected ? 'Edit' : 'Connect'}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="prov-body" id={'pv-' + p.id}>
                      <ProviderEditor p={p} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <OrderBox providers={q.data} busy={orderBusy} onMove={move} />
        </>
      )}
    </section>
  );
}

function OrderBox({ providers, busy, onMove }: { providers: Provider[]; busy: boolean; onMove: (list: Provider[], i: number, d: number) => void }) {
  const list = providers.filter((p) => p.configured && p.enabled);
  return (
    <div className="box" style={{ padding: 22 }}>
      <h3 className="h3">Default order</h3>
      <p className="mut" style={{ margin: '6px 0 16px', fontSize: 14, lineHeight: 1.5 }}>
        The first provider is used. If it's down or out of free requests, the next one takes over.
      </p>
      {list.length === 0 ? (
        <p className="mut" style={{ margin: 0, fontSize: 14 }}>
          No providers are connected yet. Without one, jobs are scored with a simple offline check and replies are not drafted well.
        </p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }} aria-busy={busy}>
          {list.map((p, i) => (
            <li key={p.id} className="order">
              <span className={i === 0 ? 'num first' : 'num'} aria-hidden="true">
                {i + 1}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span className="mut" style={{ fontSize: 13.5, marginLeft: 10 }}>
                  {p.model}
                </span>
              </span>
              <button type="button" className="btn btn-q icon" onClick={() => onMove(list, i, -1)} disabled={busy || i === 0} aria-label={`Move ${p.name} up`}>
                <Icon.Up />
              </button>
              <button type="button" className="btn btn-q icon" onClick={() => onMove(list, i, 1)} disabled={busy || i === list.length - 1} aria-label={`Move ${p.name} down`}>
                <Icon.Down />
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="mut" style={{ margin: '14px 0 0', fontSize: 13 }}>
        Only connected providers can be in the order.
      </p>
    </div>
  );
}

/* ---------------- Telegram ---------------- */

export function TelegramForm({ compact = false, onConnected }: { compact?: boolean; onConnected?: () => void }) {
  const qc = useQueryClient();
  const q = useTelegram();
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [busy, setBusy] = useState<'save' | 'find' | 'test' | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    if (q.data?.chatId) setChatId(q.data.chatId);
  }, [q.data?.chatId]);

  if (q.isPending) return <Loading label="Loading Telegram settings" />;
  if (q.isError) return <ErrorState what="Telegram settings" error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data;

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: qk.telegram }), qc.invalidateQueries({ queryKey: qk.overview })]);

  const save = async (): Promise<boolean> => {
    const body: { botToken?: string; chatId?: string } = {};
    if (token.trim()) body.botToken = token.trim();
    if (chatId.trim() !== (t.chatId ?? '')) body.chatId = chatId.trim();
    if (Object.keys(body).length === 0) return true;
    setBusy('save');
    setMsg(null);
    try {
      const saved = await api.saveTelegram(body);
      qc.setQueryData(qk.telegram, saved);
      await refresh();
      setToken('');
      setMsg({ tone: 'ok', text: 'Saved.' });
      return true;
    } catch (e) {
      setMsg({ tone: 'err', text: `Couldn't save: ${errorMessage(e)}.` });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const find = async () => {
    if (!(await save())) return;
    setBusy('find');
    setMsg(null);
    try {
      const r = await api.findTelegramChat();
      if (r.chatId) {
        setChatId(r.chatId);
        await refresh();
      }
      setMsg({ tone: r.chatId ? 'ok' : 'err', text: r.message });
    } catch (e) {
      setMsg({ tone: 'err', text: `Couldn't find your chat: ${errorMessage(e)}.` });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (!(await save())) return;
    setBusy('test');
    setMsg(null);
    try {
      const r = await api.testTelegram();
      setMsg({ tone: r.ok ? 'ok' : 'err', text: r.message });
      if (r.ok) onConnected?.();
    } catch (e) {
      setMsg({ tone: 'err', text: `Couldn't send a test message: ${errorMessage(e)}.` });
    } finally {
      setBusy(null);
    }
  };

  const hasToken = Boolean(t.tokenHint) || Boolean(token.trim());
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="grid2">
        <div>
          <label className="lbl" htmlFor={compact ? 'tg' : 'tg-token'}>
            Bot token
          </label>
          <input
            className="in"
            id={compact ? 'tg' : 'tg-token'}
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t.tokenHint ? `Saved (${t.tokenHint}). Type to replace it.` : '123456:ABC…'}
          />
        </div>
        <div>
          <label className="lbl" htmlFor={compact ? 'tg-chat-s' : 'tg-chat'}>
            Chat ID
          </label>
          <input className="in" id={compact ? 'tg-chat-s' : 'tg-chat'} inputMode="numeric" value={chatId} onChange={(e) => setChatId(e.target.value)} aria-describedby="tg-chat-h" />
          <div className="hint" id="tg-chat-h">
            Send any message to your bot first, then press Find my chat.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-s btn-p" onClick={() => void save()} disabled={busy !== null}>
          {busy === 'save' ? <span className="spinner" /> : null}
          Save
        </button>
        <button type="button" className="btn btn-s" onClick={find} disabled={busy !== null || !hasToken}>
          {busy === 'find' ? <span className="spinner" /> : null}
          Find my chat
        </button>
        <button type="button" className="btn btn-s" onClick={test} disabled={busy !== null || !hasToken || !chatId.trim()}>
          {busy === 'test' ? <span className="spinner" /> : null}
          Send a test message
        </button>
        <MsgLine msg={msg ?? (t.configured ? { tone: 'ok', text: 'Connected.' } : null)} />
      </div>
    </div>
  );
}

/* ---------------- Page ---------------- */

export function SettingsPage() {
  usePageTitle('Settings');
  const loc = useLocation();
  const [params, setParams] = useSearchParams();
  const needAccount = params.has('needAccount');
  // Upwork sends the browser back here after sign-in; show the result once, then tidy the address.
  const [upworkNotice, setUpworkNotice] = useState(() => ({ connectedId: params.get('connected'), error: params.get('upworkError') }));
  useEffect(() => {
    if (!params.has('connected') && !params.has('upworkError')) return;
    const next = new URLSearchParams(params);
    next.delete('connected');
    next.delete('upworkError');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to the hash once the content has rendered.
  useEffect(() => {
    if (!loc.hash) return;
    const t = setTimeout(() => document.getElementById(loc.hash.slice(1))?.scrollIntoView({ block: 'start' }), 50);
    return () => clearTimeout(t);
  }, [loc.hash]);

  return (
    <>
      <h1 className="h1" style={{ marginBottom: 28 }}>Settings</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <nav aria-label="Settings sections" className="set-nav">
          <a className="sjump" href="#accounts">Upwork accounts</a>
          <a className="sjump" href="#ai">AI providers</a>
          <a className="sjump" href="#alerts">Telegram alerts</a>
          <a className="sjump" href="#data">Your data</a>
          <Link className="sjump" to="/setup">Setup guide</Link>
        </nav>

        <div style={{ flex: '1 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 40 }}>
          <AccountsSection
            highlightNew={needAccount}
            connectedId={upworkNotice.connectedId}
            upworkError={upworkNotice.error}
            onDismissNotice={() => setUpworkNotice({ connectedId: null, error: null })}
          />
          <ProvidersSection />

          <section id="alerts" aria-labelledby="h-tg" style={{ display: 'flex', flexDirection: 'column', gap: 16, scrollMarginTop: 16 }}>
            <div>
              <h2 className="h2" id="h-tg">Telegram alerts</h2>
              <p className="mut" style={{ margin: '6px 0 0', fontSize: 14.5, lineHeight: 1.5, maxWidth: '62ch' }}>
                Get each new draft on your phone with Submit and Skip buttons. Tapping Submit approves that one proposal, and it is then sent within the account's limits. Create a bot
                with BotFather in Telegram, then paste its token here.
              </p>
            </div>
            <div className="box" style={{ padding: 22 }}>
              <TelegramForm />
            </div>
          </section>

          <section id="data" aria-labelledby="h-data" style={{ display: 'flex', flexDirection: 'column', gap: 16, scrollMarginTop: 16 }}>
            <h2 className="h2" id="h-data">Your data</h2>
            <div className="box">
              <div className="line">
                <div style={{ flex: '1 1 260px' }}>
                  <div style={{ fontWeight: 600 }}>Download applied jobs</div>
                  <div className="mut" style={{ fontSize: 13.5, marginTop: 3 }}>
                    Every sent proposal, whether you or the app sent it, with its status, notes and Connects, as a CSV file.
                  </div>
                </div>
                <a className="btn btn-s" href={applicationsCsvUrl} download>
                  <Icon.Download />
                  Download CSV
                </a>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
