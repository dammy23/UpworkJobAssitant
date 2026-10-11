import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api/client';
import { qk, useAccounts, useDrafts } from '../api/queries';
import type { Draft, DraftSort, RewriteInstruction, SkipReason } from '../api/types';
import { Avatar, ErrorState, Icon, Loading, Meter } from '../components/ui';
import { money, numOrNull, relTime, splitLines, wordCount } from '../lib/format';
import { PHONE_QUERY, useMediaQuery, usePageTitle, useTick } from '../lib/hooks';

const REWRITES: { id: RewriteInstruction; label: string; short: string }[] = [
  { id: 'new', label: 'Write a new version', short: 'New version' },
  { id: 'shorter', label: 'Make it shorter', short: 'Shorter' },
  { id: 'warmer', label: 'Make it warmer', short: 'Warmer' },
  { id: 'specific', label: 'More specific', short: 'More specific' },
];

/** Copies synchronously (keeps the click's user gesture for window.open), falls back to the async API. */
function copyText(text: string): Promise<boolean> {
  let ok = false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ok = document.execCommand('copy');
    document.body.removeChild(ta);
  } catch {
    ok = false;
  }
  if (ok) return Promise.resolve(true);
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
  }
  return Promise.resolve(false);
}

function clientFacts(d: Draft): { k: string; v: string }[] {
  const j = d.job;
  const out: { k: string; v: string }[] = [];
  if (j.clientCountry) out.push({ k: 'Location', v: j.clientCountry });
  if (j.clientPaymentVerified !== null) out.push({ k: 'Payment', v: j.clientPaymentVerified ? 'Verified' : 'Not verified' });
  out.push({ k: 'Hire rate', v: j.clientHireRate === null ? 'New client' : `${Math.round(j.clientHireRate)}%` });
  if (j.clientTotalSpend !== null) out.push({ k: 'Spent on Upwork', v: money(j.clientTotalSpend) });
  if (j.experienceLevel) out.push({ k: 'Experience', v: j.experienceLevel.charAt(0).toUpperCase() + j.experienceLevel.slice(1) });
  if (j.category) out.push({ k: 'Category', v: j.category });
  return out;
}

function replaceInCache(qc: ReturnType<typeof useQueryClient>, updated: Draft) {
  qc.setQueriesData<Draft[]>({ queryKey: qk.draftsAll }, (old) => old?.map((d) => (d.id === updated.id ? updated : d)));
}
function removeFromCache(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.setQueriesData<Draft[]>({ queryKey: qk.draftsAll }, (old) => old?.filter((d) => d.id !== id));
}

/* ---------------- Detail ---------------- */

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

function DraftDetail({
  draft,
  isPhone,
  position,
  total,
  onBack,
  onNext,
  onDone,
}: {
  draft: Draft;
  isPhone: boolean;
  position: number;
  total: number;
  onBack: () => void;
  onNext: (() => void) | null;
  onDone: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState(draft.draft);
  const savedRef = useRef(draft.draft);
  const textRef = useRef(text);
  textRef.current = text;
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [rewriting, setRewriting] = useState<RewriteInstruction | null>(null);
  const [rewriteErr, setRewriteErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [connects, setConnects] = useState('');
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const connectsRef = useRef<HTMLInputElement>(null);

  const persist = async (value: string): Promise<boolean> => {
    if (value === savedRef.current) return true;
    setSave({ kind: 'saving' });
    try {
      const updated = await api.updateDraft(draft.id, value);
      savedRef.current = value;
      replaceInCache(qc, { ...updated, draft: value });
      if (textRef.current === value) setSave({ kind: 'saved' });
      return true;
    } catch (e) {
      setSave({ kind: 'error', message: errorMessage(e) });
      return false;
    }
  };

  // Debounced save while typing.
  useEffect(() => {
    if (text === savedRef.current) return;
    const t = setTimeout(() => void persist(text), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Flush unsaved edits when leaving this draft.
  useEffect(
    () => () => {
      if (textRef.current !== savedRef.current) void api.updateDraft(draft.id, textRef.current).catch(() => undefined);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (confirming) connectsRef.current?.focus();
  }, [confirming]);

  const rewrite = async (instruction: RewriteInstruction) => {
    setRewriteErr(null);
    setRewriting(instruction);
    try {
      if (textRef.current !== savedRef.current) await persist(textRef.current);
      const updated = await api.rewriteDraft(draft.id, instruction);
      savedRef.current = updated.draft;
      setText(updated.draft);
      setSave({ kind: 'idle' });
      replaceInCache(qc, updated);
    } catch (e) {
      setRewriteErr(errorMessage(e));
    } finally {
      setRewriting(null);
    }
  };

  const copyAndOpen = () => {
    const value = textRef.current;
    void copyText(value).then((ok) =>
      setCopyNote(ok ? 'Reply copied. Paste it into the proposal on Upwork.' : "Couldn't copy automatically. Select the reply and copy it."),
    );
    window.open(draft.job.url, '_blank', 'noopener');
    void persist(value);
  };

  const finished = () => {
    removeFromCache(qc, draft.id);
    void qc.invalidateQueries({ queryKey: qk.draftsAll });
    void qc.invalidateQueries({ queryKey: qk.overview });
    void qc.invalidateQueries({ queryKey: qk.appliers });
  };

  const applied = useMutation({
    mutationFn: () => api.markApplied(draft.id, { connectsSpent: numOrNull(connects), proposalText: textRef.current }),
    onSuccess: () => {
      savedRef.current = textRef.current;
      void qc.invalidateQueries({ queryKey: qk.applicationsAll });
      onDone(draft.id);
      finished();
    },
    onError: (e) => setActionErr(`Couldn't save it to Applied jobs: ${errorMessage(e)}.`),
  });

  const skip = useMutation({
    mutationFn: (reason: SkipReason) => api.skipDraft(draft.id, reason),
    onSuccess: () => {
      savedRef.current = textRef.current;
      onDone(draft.id);
      finished();
    },
    onError: (e) => setActionErr(`Couldn't skip this draft: ${errorMessage(e)}.`),
  });

  const busy = applied.isPending || skip.isPending;
  const words = wordCount(text);
  const over = words > draft.applier.maxWords;
  const reasons = splitLines(draft.reasons);
  const flags = splitLines(draft.redFlags);
  const facts = clientFacts(draft);
  const j = draft.job;

  const saveLabel =
    save.kind === 'saving' ? 'Saving…' : save.kind === 'saved' ? 'Saved' : save.kind === 'error' ? `Couldn't save: ${save.message}` : '';

  const jobPost = (
    <>
      <p style={{ margin: '12px 0 0', fontSize: 15, lineHeight: 1.65, whiteSpace: 'pre-line' }}>{j.description}</p>
      {j.skills.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 16 }}>
          {j.skills.map((k) => (
            <span key={k} className="chip">
              {k}
            </span>
          ))}
        </div>
      )}
    </>
  );

  const confirmPanel = (
    <div className={isPhone ? 'confirm bottom' : 'confirm'} role="region" aria-label="Save it to Applied jobs">
      <div style={{ flex: '1 1 220px' }}>
        <div style={{ font: "700 17px/1.3 'Bricolage Grotesque', sans-serif" }}>Save it to Applied jobs</div>
        <div style={{ fontSize: 13.5, color: '#BFD0CB', marginTop: 4 }}>The reply above is saved with it, so you can see what you sent.</div>
      </div>
      <div style={{ width: 140 }}>
        <label htmlFor="connects" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          Connects spent
        </label>
        <input
          ref={connectsRef}
          className="in"
          id="connects"
          inputMode="numeric"
          value={connects}
          onChange={(e) => setConnects(e.target.value.replace(/[^\d]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applied.mutate();
            if (e.key === 'Escape') setConfirming(false);
          }}
        />
      </div>
      <button type="button" className="btn btn-gold" onClick={() => applied.mutate()} disabled={applied.isPending}>
        {applied.isPending ? <span className="spinner" /> : null}
        Save as applied
      </button>
      <button type="button" className="btn btn-q" onClick={() => setConfirming(false)} disabled={applied.isPending}>
        Cancel
      </button>
    </div>
  );

  const actions = (
    <div className={isPhone ? 'rv-actions bottom' : 'rv-actions'}>
      <button type="button" className="btn btn-p" onClick={copyAndOpen} disabled={busy}>
        Copy reply and open job
      </button>
      <button type="button" className="btn" onClick={() => { setActionErr(null); setConfirming(true); }} disabled={busy}>
        I've submitted it
      </button>
      <button type="button" className="btn btn-q" onClick={() => skip.mutate('skip')} disabled={busy}>
        {skip.isPending && skip.variables === 'skip' ? <span className="spinner" /> : null}
        Skip
      </button>
      {!isPhone && (
        <button type="button" className="btn btn-q" onClick={() => skip.mutate('bad_match')} disabled={busy}>
          {skip.isPending && skip.variables === 'bad_match' ? <span className="spinner" /> : null}
          Not a good match
        </button>
      )}
    </div>
  );

  return (
    <div className="rv-detail" aria-label="Selected draft">
      {isPhone && (
        <div className="rv-mobile-head">
          <button type="button" onClick={onBack} aria-label="Back to drafts">
            <Icon.Back size={22} />
          </button>
          <span style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>
            Draft {position} of {total}
          </span>
          {onNext && (
            <button type="button" onClick={onNext} aria-label="Next draft">
              <Icon.Next size={22} />
            </button>
          )}
        </div>
      )}

      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ minWidth: 0, flex: '1 1 360px' }}>
          <h2 className="h2 h2-lg">{j.title}</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 20px', marginTop: 10, fontSize: 14, color: '#47605B' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Avatar id={draft.account.id} name={draft.account.name} size={22} />
              {draft.account.name}'s account
            </span>
            <span>{draft.applier.name} applier</span>
            {j.budgetLabel && <span>{j.budgetLabel}</span>}
            {j.proposalsCount !== null && <span>{j.proposalsCount} proposals so far</span>}
            {j.postedAt && <span>Posted {relTime(j.postedAt)}</span>}
          </div>
        </div>
        {!isPhone && (
          <a className="btn" href={j.url} target="_blank" rel="noopener noreferrer">
            View on Upwork
            <Icon.External />
          </a>
        )}
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        {!isPhone && (
          <article className="jobpost">
            <h3 className="h3">The job post</h3>
            {jobPost}
            {facts.length > 0 && (
              <>
                <h3 className="h3" style={{ marginTop: 24 }}>The client</h3>
                <div style={{ marginTop: 6 }}>
                  {facts.map((c) => (
                    <div className="fact" key={c.k}>
                      <span className="mut">{c.k}</span>
                      <span style={{ fontWeight: 600 }}>{c.v}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </article>
        )}

        <section style={{ flex: '1.3 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }} role="img" aria-label={`Fit ${draft.score} out of 100`}>
              <span style={{ font: `700 ${isPhone ? 34 : 40}px/1 'Bricolage Grotesque', sans-serif` }}>{draft.score}</span>
              <div>
                <Meter score={draft.score} />
                <div className="mut" style={{ fontSize: 13, marginTop: 6 }}>
                  Fit with this applier's skills, budget and client rules
                </div>
              </div>
            </div>
            {(reasons.length > 0 || flags.length > 0) && (
              <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, lineHeight: 1.45 }}>
                {reasons.map((w, i) => (
                  <li key={'r' + i} style={{ display: 'flex', gap: 10 }}>
                    <Icon.Check className="ok" size={18} strokeWidth={2.2} />
                    <span>
                      <span className="sr-only">Good fit: </span>
                      {w}
                    </span>
                  </li>
                ))}
                {flags.map((w, i) => (
                  <li key={'f' + i} style={{ display: 'flex', gap: 10 }}>
                    <Icon.Flag className="warn" />
                    <span>
                      <span className="sr-only">Watch out: </span>
                      {w}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {isPhone && (
              <details style={{ marginTop: 12, borderTop: '1px solid #E4EAE8', paddingTop: 10 }}>
                <summary style={{ minHeight: 36, display: 'flex', alignItems: 'center', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  Read the job post
                </summary>
                {jobPost}
                {facts.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    {facts.map((c) => (
                      <div className="fact" key={c.k}>
                        <span className="mut">{c.k}</span>
                        <span style={{ fontWeight: 600 }}>{c.v}</span>
                      </div>
                    ))}
                  </div>
                )}
                <a className="btn btn-s" style={{ marginTop: 12 }} href={j.url} target="_blank" rel="noopener noreferrer">
                  View on Upwork <Icon.External />
                </a>
              </details>
            )}
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <label className="lbl" htmlFor="draft" style={{ margin: 0, font: "700 17px/1.25 'Bricolage Grotesque', sans-serif" }}>
                Your reply
              </label>
              <span style={{ fontSize: 13 }} className={over ? 'warn' : 'mut'} aria-live="polite">
                {saveLabel && (
                  <span className={save.kind === 'error' ? 'err-text' : 'mut'} style={{ marginRight: 10 }}>
                    {saveLabel}
                  </span>
                )}
                {words} of {draft.applier.maxWords} words
              </span>
            </div>
            <textarea
              className="in"
              id="draft"
              rows={isPhone ? 9 : 11}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => void persist(textRef.current)}
              disabled={rewriting !== null}
              aria-busy={rewriting !== null}
            />
            <div style={{ display: 'flex', flexWrap: isPhone ? 'nowrap' : 'wrap', overflowX: isPhone ? 'auto' : undefined, gap: 6 }} role="group" aria-label="Rewrite the reply">
              {REWRITES.map((r) => (
                <button key={r.id} type="button" className="rw" style={{ flex: 'none' }} onClick={() => void rewrite(r.id)} disabled={rewriting !== null || busy}>
                  {rewriting === r.id ? <span className="spinner" /> : r.id === 'new' && !isPhone ? <Icon.Refresh /> : null}
                  {isPhone ? r.short : r.label}
                </button>
              ))}
            </div>
            {rewriting && (
              <div className="mut small" role="status">
                Rewriting the reply…
              </div>
            )}
            {rewriteErr && (
              <div className="note note-err" role="alert">
                Couldn't rewrite the reply: {rewriteErr}. Try again.
              </div>
            )}
            {draft.attachments.length > 0 && (
              <div style={{ paddingTop: 14, borderTop: '1px solid #E4EAE8' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Attach on Upwork</div>
                <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
                  {draft.attachments.map((t) => (
                    <li key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Icon.Clip className="mut" />
                      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{t.fileName ?? t.title}</span>
                      {t.downloadUrl ? (
                        <a href={t.downloadUrl} download={t.fileName ?? true} style={{ fontSize: 13, fontWeight: 600 }}>
                          Download<span className="sr-only"> {t.fileName ?? t.title}</span>
                        </a>
                      ) : t.url ? (
                        <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600 }}>
                          Open link<span className="sr-only"> {t.title}</span>
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {copyNote && (
            <div className="mut small" role="status">
              {copyNote}
            </div>
          )}
          {actionErr && (
            <div className="note note-err" role="alert">
              {actionErr} Try again.
            </div>
          )}
          {isPhone && (
            <button type="button" className="btn btn-q" style={{ alignSelf: 'flex-start' }} onClick={() => skip.mutate('bad_match')} disabled={busy}>
              Not a good match
            </button>
          )}
          {confirming ? confirmPanel : actions}
        </section>
      </div>
    </div>
  );
}

/* ---------------- Page ---------------- */

export function ReviewPage() {
  usePageTitle('Review drafts');
  useTick();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [params, setParams] = useSearchParams();
  const [accountId, setAccountId] = useState(params.get('account') ?? '');
  const [sort, setSort] = useState<DraftSort>(params.get('sort') === 'newest' ? 'newest' : 'score');
  const accounts = useAccounts();
  const q = useDrafts(accountId, sort);
  const list = useMemo(() => q.data ?? [], [q.data]);
  const selParam = params.get('draft');

  const selected: Draft | null = list.find((d) => d.id === selParam) ?? (isPhone ? null : (list[0] ?? null));
  const selIndex = selected ? list.findIndex((d) => d.id === selected.id) : -1;

  const select = (id: string | null, push = isPhone) => {
    const next = new URLSearchParams(params);
    if (id) next.set('draft', id);
    else next.delete('draft');
    setParams(next, { replace: !push });
  };

  // After an action, move to the next draft in the list (or the previous if it was the last).
  const onDone = (id: string) => {
    const i = list.findIndex((d) => d.id === id);
    const next = list[i + 1] ?? list[i - 1] ?? null;
    select(next ? next.id : null, false);
  };

  // Keep the selection valid on desktop when filters change.
  useEffect(() => {
    if (!isPhone && selParam && q.isSuccess && !list.some((d) => d.id === selParam)) select(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPhone, selParam, q.isSuccess, list]);

  const showList = !isPhone || !selected;
  const showDetail = Boolean(selected);

  return (
    <>
      {showList && (
        <div className="top" style={{ marginBottom: 24 }}>
          <div>
            <h1 className="h1">Review drafts</h1>
            <p className="sub" style={{ color: '#5A706B' }}>
              Read the job, tidy the reply, then submit it on Upwork from the right account.
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <label className="sr-only" htmlFor="f-acct">
              Upwork account
            </label>
            <select className="sel" id="f-acct" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">All accounts</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="f-sort">
              Sort
            </label>
            <select className="sel" id="f-sort" value={sort} onChange={(e) => setSort(e.target.value as DraftSort)}>
              <option value="score">Best fit first</option>
              <option value="newest">Newest first</option>
            </select>
          </div>
        </div>
      )}

      {q.isPending ? (
        <Loading label="Loading drafts" />
      ) : q.isError ? (
        <ErrorState what="drafts" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="rv-wrap">
          {showList && (
            <div role="listbox" aria-label="Drafts" className="rv-list">
              {list.map((d) => {
                const on = selected?.id === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={on ? 'item on' : 'item'}
                    role="option"
                    aria-selected={on}
                    onClick={() => select(d.id)}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 44, flex: 'none' }}>
                      <span className="fitn" aria-label={`Fit ${d.score} out of 100`}>
                        {d.score}
                      </span>
                      <Meter score={d.score} segments={5} mini />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14.5, lineHeight: 1.35 }}>{d.job.title}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 13, color: '#47605B' }}>
                        <Avatar id={d.account.id} name={d.account.name} size={22} />
                        <span className="sr-only">{d.account.name}, </span>
                        <span>{d.applier.name}</span>
                      </div>
                      <div style={{ marginTop: 4, fontSize: 13, color: '#5A706B' }}>
                        {[d.job.budgetLabel, d.job.postedAt ? `posted ${relTime(d.job.postedAt)}` : ''].filter(Boolean).join(', ')}
                      </div>
                    </div>
                  </button>
                );
              })}
              {list.length === 0 && (
                <div style={{ padding: '24px 16px', fontSize: 14, lineHeight: 1.5, color: '#47605B' }}>
                  {accountId
                    ? 'Nothing is waiting for this account. Try All accounts, or check back later.'
                    : "That's everything for now. New drafts appear here as your appliers find good matches."}
                  <div style={{ marginTop: 12 }}>
                    <Link to="/appliers">See your appliers</Link>
                  </div>
                </div>
              )}
            </div>
          )}
          {showDetail && selected && (
            <DraftDetail
              key={selected.id}
              draft={selected}
              isPhone={isPhone}
              position={selIndex + 1}
              total={list.length}
              onBack={() => select(null, false)}
              onNext={list[selIndex + 1] ? () => select(list[selIndex + 1].id, false) : null}
              onDone={onDone}
            />
          )}
        </div>
      )}
    </>
  );
}
