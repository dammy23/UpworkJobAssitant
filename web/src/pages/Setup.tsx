import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api/client';
import { qk, useAccounts, useOverview, useProviders, useTemplates } from '../api/queries';
import type { Provider, ProviderId } from '../api/types';
import { ErrorState, Icon, Loading } from '../components/ui';
import { AccountForm, TelegramForm } from './Settings';
import { usePageTitle } from '../lib/hooks';

const AI_TILES: { id: ProviderId; name: string; note: string; label: string; ph: string; hint: string }[] = [
  { id: 'groq', name: 'Groq', note: 'Free tier. Fast and good enough to start.', label: 'Groq API key', ph: 'gsk_…', hint: 'Get one free at console.groq.com.' },
  { id: 'claude', name: 'Claude', note: 'Best writing. Paid per use.', label: 'Anthropic API key', ph: 'sk-ant-…', hint: 'From console.anthropic.com.' },
  { id: 'openai', name: 'OpenAI', note: 'Paid per use.', label: 'OpenAI API key', ph: 'sk-…', hint: 'From platform.openai.com.' },
  { id: 'ollama', name: 'Ollama', note: 'Runs on your computer. Free and private.', label: 'Ollama server address', ph: 'http://localhost:11434', hint: 'Install Ollama and pull a model such as qwen3:14b first.' },
];

function Step({
  n,
  title,
  summary,
  done,
  open,
  onToggle,
  children,
}: {
  n: number;
  title: string;
  summary: string;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <li className={open ? 'step cur' : 'step'}>
      <button type="button" className="stephead" onClick={onToggle} aria-expanded={open} aria-controls={'step-' + n}>
        <span className={done ? 'n done' : open ? 'n cur' : 'n'} aria-hidden="true">
          {done ? <Icon.Check size={16} /> : n}
        </span>
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', font: "700 19px/1.25 'Bricolage Grotesque', sans-serif" }}>
            {title}
            {done && <span className="sr-only"> (done)</span>}
          </span>
          <span className="mut" style={{ display: 'block', fontSize: 14, marginTop: 4 }}>
            {summary}
          </span>
        </span>
      </button>
      {open && (
        <div className="stepbody" id={'step-' + n}>
          {children}
        </div>
      )}
    </li>
  );
}

function AccountStep({ onDone }: { onDone: () => void }) {
  const [withKey, setWithKey] = useState(false);
  return (
    <>
      <div className="note">
        <strong>Request an API key from Upwork.</strong> On upwork.com/developer, choose personal use and describe it as a read-only job search tool. Approval can take a few days. Until then,
        the app shows sample jobs so you can try everything.
      </div>
      {withKey ? (
        <AccountForm account={null} onDone={onDone} onCancel={() => setWithKey(false)} submitLabel="Save account" />
      ) : (
        <SimpleAccount onDone={onDone} onHaveKey={() => setWithKey(true)} />
      )}
    </>
  );
}

function SimpleAccount({ onDone, onHaveKey }: { onDone: () => void; onHaveKey: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameErr = tried && !name.trim();
  const submit = async () => {
    setTried(true);
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.createAccount({ name: name.trim(), email: email.trim() || undefined });
      await Promise.all([qc.invalidateQueries({ queryKey: qk.accounts }), qc.invalidateQueries({ queryKey: qk.overview })]);
      onDone();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div>
          <label className="lbl" htmlFor="a-name">
            Whose account is it?
          </label>
          <input className="in" id="a-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={nameErr} aria-describedby={nameErr ? 'a-name-e' : undefined} />
          {nameErr && (
            <div className="field-err" id="a-name-e">
              Add a name, such as your first name.
            </div>
          )}
        </div>
        <div>
          <label className="lbl" htmlFor="a-email">
            Upwork email
          </label>
          <input className="in" id="a-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      {err && (
        <div className="note note-err" role="alert">
          Couldn't save the account: {err}. Try again.
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button type="submit" className="btn btn-p" disabled={busy}>
          {busy ? <span className="spinner" /> : null}
          Save and use sample jobs for now
        </button>
        <button type="button" className="btn" onClick={onHaveKey}>
          I already have a key
        </button>
      </div>
    </form>
  );
}

function ProviderStep({ providers, onDone }: { providers: Provider[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [pick, setPick] = useState<ProviderId>(() => providers.find((p) => p.configured)?.id ?? 'groq');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const tile = AI_TILES.find((t) => t.id === pick)!;
  const p = providers.find((x) => x.id === pick);

  useEffect(() => {
    setMsg(null);
    setValue(p?.needsBaseUrl ? (p.baseUrl ?? '') : '');
  }, [pick, p?.needsBaseUrl, p?.baseUrl]);

  const go = async () => {
    if (!p) return;
    setBusy(true);
    setMsg(null);
    try {
      const body: { enabled: boolean; apiKey?: string; baseUrl?: string } = { enabled: true };
      if (p.needsBaseUrl) body.baseUrl = value.trim() || 'http://localhost:11434';
      else if (value.trim()) body.apiKey = value.trim();
      else if (!p.configured) {
        setMsg({ ok: false, text: 'Paste the key first.' });
        setBusy(false);
        return;
      }
      await api.updateProvider(p.id, body);
      const r = await api.testProvider(p.id);
      await Promise.all([qc.invalidateQueries({ queryKey: qk.providers }), qc.invalidateQueries({ queryKey: qk.overview })]);
      setMsg({ ok: r.ok, text: r.message || (r.ok ? 'It works.' : 'The test failed.') });
      if (r.ok) {
        setValue('');
        onDone();
      }
    } catch (e) {
      setMsg({ ok: false, text: `Couldn't save it: ${errorMessage(e)}.` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="tiles" role="radiogroup" aria-label="AI provider">
        {AI_TILES.map((t) => {
          const on = t.id === pick;
          const exists = providers.some((x) => x.id === t.id);
          return (
            <button key={t.id} type="button" className={on ? 'tile on' : 'tile'} role="radio" aria-checked={on} disabled={!exists} onClick={() => setPick(t.id)}>
              <b>{t.name}</b>
              <span>{t.note}</span>
            </button>
          );
        })}
      </div>
      <div>
        <label className="lbl" htmlFor="ai-key">
          {tile.label}
        </label>
        <input
          className="in"
          id="ai-key"
          type={p?.needsBaseUrl ? 'url' : 'password'}
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={p?.apiKeyHint ? `Saved (${p.apiKeyHint}). Type to replace it.` : tile.ph}
          aria-describedby="ai-key-h"
        />
        <div className="hint" id="ai-key-h">
          {tile.hint}
        </div>
      </div>
      {msg && (
        <div className={msg.ok ? 'note note-ok' : 'note note-err'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button type="button" className="btn btn-p" onClick={go} disabled={busy || !p}>
          {busy ? <span className="spinner" /> : null}
          {busy ? 'Testing…' : 'Test and save'}
        </button>
        <Link className="btn btn-q" to="/settings#ai">
          More options in Settings
        </Link>
      </div>
    </>
  );
}

function TemplateStep({ hasAccount }: { hasAccount: boolean }) {
  const navigate = useNavigate();
  const q = useTemplates();
  const [pick, setPick] = useState<string | null>(null);
  if (q.isPending) return <Loading label="Loading kinds of work" />;
  if (q.isError) return <ErrorState what="kinds of work" error={q.error} onRetry={() => q.refetch()} />;
  const tiles = [...q.data.map((t) => ({ id: t.id, name: t.name, note: t.note })), { id: '', name: 'Start blank', note: 'Set every rule yourself' }];
  const cur = tiles.find((t) => t.id === (pick ?? tiles[0]?.id)) ?? tiles[0];
  return (
    <>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5 }}>Pick the kind of work you want. Each one starts with sensible role titles, skills and rules that you can change.</p>
      <div className="tiles" role="radiogroup" aria-label="Kind of work">
        {tiles.map((t) => {
          const on = t.id === cur.id;
          return (
            <button key={t.id || 'blank'} type="button" className={on ? 'tile on' : 'tile'} role="radio" aria-checked={on} onClick={() => setPick(t.id)}>
              <b>{t.name}</b>
              <span>{t.note}</span>
            </button>
          );
        })}
      </div>
      {!hasAccount && (
        <div className="note" role="note">
          Add your Upwork account in step 1 first. Appliers search for jobs on an account.
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button
          type="button"
          className="btn btn-p"
          disabled={!hasAccount}
          onClick={() => navigate(cur.id ? `/appliers/new?template=${encodeURIComponent(cur.id)}` : '/appliers/new')}
        >
          Continue with {cur.name.toLowerCase()}
        </button>
      </div>
    </>
  );
}

export function SetupPage() {
  usePageTitle('Setup');
  const overview = useOverview();
  const accounts = useAccounts();
  const providers = useProviders();
  const [open, setOpen] = useState<number | null>(null);
  const [telegramSkipped, setTelegramSkipped] = useState(false);

  const s = overview.data?.setup;
  const done = {
    1: Boolean(s?.hasAccount),
    2: Boolean(s?.hasProvider),
    3: Boolean(s?.hasApplier),
    4: Boolean(s?.hasTelegram) || telegramSkipped,
  };
  const doneCount = Object.values(done).filter(Boolean).length;
  const firstOpen = ([1, 2, 3, 4] as const).find((n) => !done[n]) ?? null;
  const current = open === null ? firstOpen : open === 0 ? null : open;
  const toggle = (n: number) => setOpen(current === n ? 0 : n);
  const advance = () => setOpen(null);

  const firstAccount = accounts.data?.[0];
  const configured = providers.data?.filter((p) => p.configured && p.enabled) ?? [];

  return (
    <div className="wrap">
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '20px 32px', flexWrap: 'wrap' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, font: "700 17px/1.1 'Bricolage Grotesque', sans-serif", textDecoration: 'none' }}>
          <span className="mark">
            <Icon.Check size={18} />
          </span>
          Job Assistant
        </Link>
        <Link className="btn btn-q" to="/">
          Finish later
        </Link>
      </header>

      <main style={{ maxWidth: 820, margin: '0 auto', padding: '24px 16px 64px' }} id="main">
        <h1 style={{ margin: 0, font: "700 clamp(32px, 6vw, 44px)/1.08 'Bricolage Grotesque', sans-serif", letterSpacing: '-.025em', maxWidth: '18ch' }}>
          Let's find your first good jobs
        </h1>
        <p className="mut" style={{ margin: '14px 0 0', fontSize: 17, lineHeight: 1.55, maxWidth: '56ch' }}>
          Four steps, about ten minutes. You can start with sample jobs while Upwork reviews your API key, and change everything later in Settings.
        </p>

        {overview.isPending ? (
          <Loading label="Checking what is set up" />
        ) : overview.isError ? (
          <div style={{ marginTop: 24 }}>
            <ErrorState what="your setup progress" error={overview.error} onRetry={() => overview.refetch()} />
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '28px 0 24px' }}>
              <div
                style={{ flex: 1, height: 8, borderRadius: 999, background: '#D5DDDA', overflow: 'hidden' }}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={4}
                aria-valuenow={doneCount}
                aria-label="Setup progress"
              >
                <div style={{ height: '100%', borderRadius: 999, background: '#F2B632', width: `${doneCount * 25}%`, transition: 'width .3s' }} />
              </div>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{doneCount} of 4 done</span>
            </div>

            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Step
                n={1}
                title="Add your Upwork account"
                summary={
                  done[1] && firstAccount
                    ? `${firstAccount.name}${firstAccount.status === 'sample' ? ', using sample jobs until the key is approved' : ', connected'}`
                    : 'Who the drafts are for, and their Upwork API key'
                }
                done={done[1]}
                open={current === 1}
                onToggle={() => toggle(1)}
              >
                {done[1] ? (
                  <p style={{ margin: 0, fontSize: 14.5 }}>
                    Done. Add more accounts or enter an approved key in <Link to="/settings#accounts">Settings</Link>.
                  </p>
                ) : (
                  <AccountStep onDone={advance} />
                )}
              </Step>

              <Step
                n={2}
                title="Choose an AI to read jobs and write replies"
                summary={done[2] ? `Connected${configured[0] ? ': ' + configured.map((p) => p.name).join(', ') : ''}` : 'Free options work fine to start'}
                done={done[2]}
                open={current === 2}
                onToggle={() => toggle(2)}
              >
                {providers.isPending ? (
                  <Loading label="Loading AI providers" />
                ) : providers.isError ? (
                  <ErrorState what="AI providers" error={providers.error} onRetry={() => providers.refetch()} />
                ) : (
                  <ProviderStep providers={providers.data} onDone={advance} />
                )}
              </Step>

              <Step
                n={3}
                title="Create your first applier"
                summary={done[3] ? 'Created' : 'Tell it what kind of work to look for'}
                done={done[3]}
                open={current === 3}
                onToggle={() => toggle(3)}
              >
                {done[3] ? (
                  <p style={{ margin: 0, fontSize: 14.5 }}>
                    Done. You can add more in <Link to="/appliers">Appliers</Link>.
                  </p>
                ) : (
                  <TemplateStep hasAccount={done[1]} />
                )}
              </Step>

              <Step
                n={4}
                title="Get alerts on your phone"
                summary={s?.hasTelegram ? 'Done' : telegramSkipped ? 'Skipped' : 'Optional: new drafts sent to Telegram'}
                done={done[4]}
                open={current === 4}
                onToggle={() => toggle(4)}
              >
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5 }}>Optional. In Telegram, message BotFather, send /newbot and copy the token it gives you.</p>
                <TelegramForm compact onConnected={advance} />
                {!s?.hasTelegram && (
                  <div>
                    <button
                      type="button"
                      className="btn btn-q"
                      onClick={() => {
                        setTelegramSkipped(true);
                        advance();
                      }}
                    >
                      Skip this
                    </button>
                  </div>
                )}
              </Step>
            </ol>

            {doneCount === 4 && (
              <div style={{ marginTop: 24, padding: 24, borderRadius: 16, background: '#12302B', color: '#FFFFFF', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: '1 1 280px' }}>
                  <div style={{ font: "700 22px/1.2 'Bricolage Grotesque', sans-serif" }}>You're set up</div>
                  <div style={{ color: '#BFD0CB', fontSize: 14.5, marginTop: 6 }}>Your applier will check for jobs in the next few minutes. Drafts show up in Review.</div>
                </div>
                <Link className="btn btn-gold" to="/">
                  Go to Home
                </Link>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
