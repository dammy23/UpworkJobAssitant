import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api/client';
import { qk, useAccounts, useDrafts } from '../api/queries';
import { DURATIONS } from '../api/types';
import type { Account, Draft, DraftEdits, DraftSort, RewriteInstruction, SkipReason, SubmitItem } from '../api/types';
import { Avatar, Dialog, ErrorState, Icon, Loading, Meter } from '../components/ui';
import { money, numOrNull, plural, relTime, splitLines, wordCount } from '../lib/format';
import { PHONE_QUERY, useMediaQuery, usePageTitle, useTick } from '../lib/hooks';

const REWRITES: { id: RewriteInstruction; label: string; short: string }[] = [
  { id: 'new', label: 'Write a new version', short: 'New version' },
  { id: 'shorter', label: 'Make it shorter', short: 'Shorter' },
  { id: 'warmer', label: 'Make it warmer', short: 'Warmer' },
  { id: 'specific', label: 'More specific', short: 'More specific' },
];

type Tab = 'ready' | 'sending' | 'failed';
const TABS: { id: Tab; label: string }[] = [
  { id: 'ready', label: 'Ready' },
  { id: 'sending', label: 'Sending' },
  { id: 'failed', label: 'Not sent' },
];
const tabOf = (d: Draft): Tab => (d.state === 'ready' ? 'ready' : d.state === 'failed' ? 'failed' : 'sending');
const isEditable = (d: Draft) => d.state === 'ready' || d.state === 'failed';

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

/** "$45/hr" or "$600 total". */
function bidLabel(amount: number | null, jobType: Draft['job']['jobType']): string {
  if (!amount) return 'No bid yet';
  return jobType === 'hourly' ? `${money(amount)}/hr` : `${money(amount)} total`;
}

function gapLabel(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return plural(m, 'minute');
}

/** The account's sending limits as one sentence, for real sends. */
function limitsLine(a: Account | undefined): string | null {
  if (!a) return null;
  return `It will be sent within your limits: up to ${a.limits.dailyProposalCap} a day, at least ${gapLabel(a.limits.minGapSeconds)} apart.`;
}

/** Whole dollars only; empty or 0 means no bid. */
function parseBid(v: string): number | null {
  const n = numOrNull(v);
  return n && n > 0 ? Math.round(n) : null;
}

function replaceInCache(qc: ReturnType<typeof useQueryClient>, updated: Draft) {
  qc.setQueriesData<Draft[]>({ queryKey: qk.draftsAll }, (old) => old?.map((d) => (d.id === updated.id ? updated : d)));
}
function removeFromCache(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.setQueriesData<Draft[]>({ queryKey: qk.draftsAll }, (old) => old?.filter((d) => d.id !== id));
}

/* ---------------- Detail: shared frame ---------------- */

type Nav = { position: number; total: number; onBack: () => void; onNext: (() => void) | null };

function DraftFrame({ draft, isPhone, nav, children }: { draft: Draft; isPhone: boolean; nav: Nav; children: ReactNode }) {
  const reasons = splitLines(draft.reasons);
  const flags = splitLines(draft.redFlags);
  const facts = clientFacts(draft);
  const j = draft.job;

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
  const factList = (
    <>
      {facts.map((c) => (
        <div className="fact" key={c.k}>
          <span className="mut">{c.k}</span>
          <span style={{ fontWeight: 600 }}>{c.v}</span>
        </div>
      ))}
    </>
  );

  return (
    <div className="rv-detail" aria-label="Selected draft">
      {isPhone && (
        <div className="rv-mobile-head">
          <button type="button" onClick={nav.onBack} aria-label="Back to drafts">
            <Icon.Back size={22} />
          </button>
          <span style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>{nav.position > 0 ? `Draft ${nav.position} of ${nav.total}` : 'Draft'}</span>
          {nav.onNext && (
            <button type="button" onClick={nav.onNext} aria-label="Next draft">
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
                <div style={{ marginTop: 6 }}>{factList}</div>
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
                <summary style={{ minHeight: 36, display: 'flex', alignItems: 'center', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Read the job post</summary>
                {jobPost}
                {facts.length > 0 && <div style={{ marginTop: 12 }}>{factList}</div>}
                <a className="btn btn-s" style={{ marginTop: 12 }} href={j.url} target="_blank" rel="noopener noreferrer">
                  View on Upwork <Icon.External />
                </a>
              </details>
            )}
          </div>
          {children}
        </section>
      </div>
    </div>
  );
}

/* ---------------- Detail: ready or failed (editable) ---------------- */

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };
type Saved = { draft: string; bidAmount: number | null; duration: string | null; answers: string };

/** Mirrors the server's readiness rules so the list updates as you type; the server's list wins after each save. */
function localProblems(serverProblems: string[], text: string, bid: number | null, questions: string[], answers: string[]): string[] {
  const out: string[] = [];
  if (!text.trim()) out.push('The reply is empty.');
  if (!bid) out.push('Add your bid.');
  const missing = questions.filter((_, i) => !(answers[i] ?? '').trim()).length;
  if (missing) out.push(`Answer ${missing === 1 ? 'the screening question' : `all ${questions.length} screening questions`}.`);
  const known = (p: string) => p === 'The reply is empty.' || p === 'Add your bid.' || /^Answer (the|all)/.test(p);
  return [...out, ...serverProblems.filter((p) => !known(p))];
}

export type EditsHandle = { id: string; get: () => DraftEdits; markSaved: () => void } | null;

function EditableDraft({
  draft,
  account,
  isPhone,
  nav,
  onDone,
  editsRef,
}: {
  draft: Draft;
  account: Account | undefined;
  isPhone: boolean;
  nav: Nav;
  onDone: (id: string) => void;
  editsRef: { current: EditsHandle };
}) {
  const qc = useQueryClient();
  const j = draft.job;
  const questions = j.questions;
  const simulated = draft.sendMode === 'simulated';
  const failed = draft.state === 'failed';
  const idp = 'd-' + draft.id.slice(0, 8);

  const [text, setText] = useState(draft.draft);
  const [bid, setBid] = useState(draft.bidAmount ? String(draft.bidAmount) : '');
  const [duration, setDuration] = useState(draft.duration ?? '');
  const [answers, setAnswers] = useState<string[]>(() => questions.map((q) => draft.answers.find((a) => a.question === q)?.answer ?? ''));

  const current = (): DraftEdits => ({
    draft: text,
    bidAmount: parseBid(bid),
    duration: duration || null,
    answers: questions.map((question, i) => ({ question, answer: answers[i] ?? '' })),
  });
  const currentRef = useRef(current);
  currentRef.current = current;
  const snapshot = (e: DraftEdits): Saved => ({ draft: e.draft ?? '', bidAmount: e.bidAmount ?? null, duration: e.duration ?? null, answers: JSON.stringify(e.answers ?? []) });
  const savedRef = useRef<Saved>(snapshot(current()));

  /** Only the fields that changed since the last save. */
  const changed = (e: DraftEdits): DraftEdits => {
    const s = savedRef.current;
    const out: DraftEdits = {};
    if (e.draft !== s.draft) out.draft = e.draft;
    if ((e.bidAmount ?? null) !== s.bidAmount) out.bidAmount = e.bidAmount;
    if ((e.duration ?? null) !== s.duration) out.duration = e.duration;
    if (JSON.stringify(e.answers ?? []) !== s.answers) out.answers = e.answers;
    return out;
  };

  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [rewriting, setRewriting] = useState<RewriteInstruction | null>(null);
  const [rewriteErr, setRewriteErr] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const [answerErr, setAnswerErr] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [connects, setConnects] = useState(j.connectsRequired !== null ? String(j.connectsRequired) : '');
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const connectsRef = useRef<HTMLInputElement>(null);

  const persist = async (): Promise<boolean> => {
    const e = currentRef.current();
    const diff = changed(e);
    if (Object.keys(diff).length === 0) return true;
    setSave({ kind: 'saving' });
    try {
      const updated = await api.updateDraft(draft.id, diff);
      savedRef.current = { ...savedRef.current, ...snapshot({ ...savedToEdits(savedRef.current), ...diff }) };
      replaceInCache(qc, updated);
      setSave(Object.keys(changed(currentRef.current())).length ? { kind: 'saving' } : { kind: 'saved' });
      return true;
    } catch (err) {
      setSave({ kind: 'error', message: errorMessage(err) });
      return false;
    }
  };

  // Debounced save while editing any field.
  useEffect(() => {
    if (Object.keys(changed(current())).length === 0) return;
    const t = setTimeout(() => void persist(), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, bid, duration, answers]);

  // Let the page include these edits when this draft is submitted from the batch bar.
  useEffect(() => {
    editsRef.current = {
      id: draft.id,
      get: () => currentRef.current(),
      markSaved: () => {
        savedRef.current = snapshot(currentRef.current());
      },
    };
    return () => {
      if (editsRef.current?.id === draft.id) editsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);

  // Flush unsaved edits when leaving this draft.
  useEffect(
    () => () => {
      const diff = changed(currentRef.current());
      if (Object.keys(diff).length) void api.updateDraft(draft.id, diff).catch(() => undefined);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (manualOpen) connectsRef.current?.focus();
  }, [manualOpen]);

  const rewrite = async (instruction: RewriteInstruction) => {
    setRewriteErr(null);
    setRewriting(instruction);
    try {
      await persist();
      const updated = await api.rewriteDraft(draft.id, instruction);
      savedRef.current = { ...savedRef.current, draft: updated.draft };
      setText(updated.draft);
      setSave({ kind: 'idle' });
      replaceInCache(qc, updated);
    } catch (e) {
      setRewriteErr(errorMessage(e));
    } finally {
      setRewriting(null);
    }
  };

  const writeAnswers = async () => {
    setAnswerErr(null);
    setAnswering(true);
    try {
      await persist();
      const updated = await api.generateAnswers(draft.id);
      const next = questions.map((q) => updated.answers.find((a) => a.question === q)?.answer ?? '');
      savedRef.current = { ...savedRef.current, answers: JSON.stringify(questions.map((question, i) => ({ question, answer: next[i] }))) };
      setAnswers(next);
      replaceInCache(qc, updated);
    } catch (e) {
      setAnswerErr(errorMessage(e));
    } finally {
      setAnswering(false);
    }
  };

  const copyAndOpen = () => {
    void copyText(text).then((ok) =>
      setCopyNote(ok ? 'Reply copied. Paste it into the proposal on Upwork.' : "Couldn't copy automatically. Select the reply and copy it."),
    );
    window.open(j.url, '_blank', 'noopener');
    void persist();
  };

  const finished = () => {
    removeFromCache(qc, draft.id);
    void qc.invalidateQueries({ queryKey: qk.draftsAll });
    void qc.invalidateQueries({ queryKey: qk.overview });
    void qc.invalidateQueries({ queryKey: qk.appliers });
  };

  const applied = useMutation({
    mutationFn: () => api.markApplied(draft.id, { connectsSpent: numOrNull(connects), proposalText: text, bidAmount: parseBid(bid) }),
    onSuccess: () => {
      savedRef.current = snapshot(currentRef.current());
      void qc.invalidateQueries({ queryKey: qk.applicationsAll });
      onDone(draft.id);
      finished();
    },
    onError: (e) => setActionErr(`Couldn't save it to Applied jobs: ${errorMessage(e)}.`),
  });

  const skip = useMutation({
    mutationFn: (reason: SkipReason) => api.skipDraft(draft.id, reason),
    onSuccess: () => {
      savedRef.current = snapshot(currentRef.current());
      onDone(draft.id);
      finished();
    },
    onError: (e) => setActionErr(`Couldn't skip this draft: ${errorMessage(e)}.`),
  });

  const submit = useMutation({
    mutationFn: () => {
      const edits = currentRef.current();
      return api.submitDrafts([{ id: draft.id, ...edits }]).then((res) => ({ res, edits }));
    },
    onSuccess: ({ res, edits }) => {
      const r = res.results.find((x) => x.id === draft.id);
      setConfirming(false);
      if (r?.ok) {
        savedRef.current = snapshot(edits);
        const updated = res.drafts.find((d) => d.id === draft.id);
        if (updated) replaceInCache(qc, updated);
        void qc.invalidateQueries({ queryKey: qk.draftsAll });
        void qc.invalidateQueries({ queryKey: qk.overview });
        void qc.invalidateQueries({ queryKey: qk.accounts });
      } else {
        setActionErr(`It wasn't sent: ${r?.error ?? 'the server did not say why'}`);
        void qc.invalidateQueries({ queryKey: qk.draftsAll });
      }
    },
    onError: (e) => {
      setConfirming(false);
      setActionErr(`Couldn't approve it: ${errorMessage(e)}.`);
    },
  });

  const busy = applied.isPending || skip.isPending || submit.isPending;
  const words = wordCount(text);
  const over = words > draft.applier.maxWords;
  const bidNum = parseBid(bid);
  const problems = localProblems(draft.problems, text, bidNum, questions, answers);
  const answeredCount = answers.filter((a) => a.trim()).length;
  const sendLabel = failed ? 'Try again' : simulated ? 'Test send' : 'Submit proposal';

  const saveLabel =
    save.kind === 'saving' ? 'Saving…' : save.kind === 'saved' ? 'Saved' : save.kind === 'error' ? `Couldn't save: ${save.message}` : '';

  const openConfirm = () => {
    setActionErr(null);
    setConfirming(true);
  };

  const manualPanel = (
    <div className="confirm" role="region" aria-label="Save it to Applied jobs" id={idp + '-manual'}>
      <div style={{ flex: '1 1 220px' }}>
        <div style={{ font: "700 17px/1.3 'Bricolage Grotesque', sans-serif" }}>Save it to Applied jobs</div>
        <div style={{ fontSize: 13.5, color: '#BFD0CB', marginTop: 4 }}>
          For a proposal you sent yourself on the Upwork website. The reply and bid above are saved with it, and the app won't send it.
        </div>
      </div>
      <div style={{ width: 140 }}>
        <label htmlFor={idp + '-connects'} style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          Connects spent
        </label>
        <input
          ref={connectsRef}
          className="in"
          id={idp + '-connects'}
          inputMode="numeric"
          value={connects}
          onChange={(e) => setConnects(e.target.value.replace(/[^\d]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applied.mutate();
            if (e.key === 'Escape') setManualOpen(false);
          }}
        />
      </div>
      <button type="button" className="btn btn-gold" onClick={() => applied.mutate()} disabled={applied.isPending}>
        {applied.isPending ? <span className="spinner" /> : null}
        Save as applied
      </button>
      <button type="button" className="btn btn-q" onClick={() => setManualOpen(false)} disabled={applied.isPending}>
        Cancel
      </button>
    </div>
  );

  return (
    <DraftFrame draft={draft} isPhone={isPhone} nav={nav}>
      {failed && (
        <div className="note note-err" role="alert">
          <strong>This proposal wasn't sent.</strong> {draft.submitError ?? 'The server did not say why.'} Check the details below, then try again.
        </div>
      )}

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <label className="lbl" htmlFor={idp + '-reply'} style={{ margin: 0, font: "700 17px/1.25 'Bricolage Grotesque', sans-serif" }}>
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
          id={idp + '-reply'}
          rows={isPhone ? 9 : 11}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void persist()}
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

      <section className="card" aria-labelledby={idp + '-pd'} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h3 className="h3" id={idp + '-pd'}>
            Proposal details
          </h3>
          {j.connectsRequired !== null && <span className="tag">Costs {plural(j.connectsRequired, 'Connect')}</span>}
        </div>
        <div className="grid2">
          <div>
            <label className="lbl" htmlFor={idp + '-bid'}>
              Your bid
            </label>
            <div className="affix">
              <span className="affix-pre" aria-hidden="true">
                $
              </span>
              <input
                className="in"
                id={idp + '-bid'}
                inputMode="numeric"
                autoComplete="off"
                value={bid}
                onChange={(e) => setBid(e.target.value.replace(/[^\d]/g, '').slice(0, 7))}
                onBlur={() => void persist()}
                aria-invalid={!bidNum}
                aria-describedby={idp + '-bid-h'}
              />
              <span className="affix-post">{j.jobType === 'hourly' ? '/hr' : 'total'}</span>
            </div>
            <div className="hint" id={idp + '-bid-h'}>
              In US dollars{j.jobType === 'hourly' ? ', per hour' : ', for the whole job'}.{j.budgetLabel ? ` Client's budget: ${j.budgetLabel}.` : ''}
            </div>
          </div>
          <div>
            <label className="lbl" htmlFor={idp + '-dur'}>
              Project duration
            </label>
            <select
              className="sel"
              id={idp + '-dur'}
              style={{ width: '100%', minHeight: 44 }}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              onBlur={() => void persist()}
            >
              <option value="">Not set</option>
              {duration && !(DURATIONS as readonly string[]).includes(duration) && <option value={duration}>{duration}</option>}
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        {questions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 16, borderTop: '1px solid #E4EAE8' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Screening questions</div>
                <div className="mut small" style={{ marginTop: 2 }}>
                  {answeredCount} of {questions.length} answered. The client asks these with the proposal.
                </div>
              </div>
              <button type="button" className="rw" onClick={() => void writeAnswers()} disabled={answering || busy}>
                {answering ? <span className="spinner" /> : <Icon.Refresh />}
                Write answers with AI
              </button>
            </div>
            {answering && (
              <div className="mut small" role="status">
                Writing answers…
              </div>
            )}
            {answerErr && (
              <div className="note note-err" role="alert">
                Couldn't write the answers: {answerErr}
              </div>
            )}
            {questions.map((q, i) => (
              <div key={i}>
                <label className="lbl" htmlFor={`${idp}-q${i}`} style={{ lineHeight: 1.45 }}>
                  {q}
                </label>
                <textarea
                  className="in"
                  id={`${idp}-q${i}`}
                  rows={3}
                  value={answers[i] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAnswers((a) => a.map((x, k) => (k === i ? v : x)));
                  }}
                  onBlur={() => void persist()}
                  disabled={answering}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {problems.length > 0 && (
        <div className="note note-warn" id={idp + '-problems'}>
          <div style={{ fontWeight: 600 }}>Before it can be sent</div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {simulated && (
        <div className="note small">
          <strong>{draft.account.name}'s account isn't signed in to Upwork yet,</strong> so sending is a test send: the app goes through every step, but nothing goes to Upwork until the
          account is connected in <Link to="/settings#accounts">Settings</Link>.
        </div>
      )}

      {copyNote && (
        <div className="mut small" role="status">
          {copyNote}
        </div>
      )}
      {actionErr && (
        <div className="note note-err" role="alert">
          {actionErr} Fix it and try again.
        </div>
      )}
      {isPhone && (
        <button type="button" className="btn btn-q" style={{ alignSelf: 'flex-start' }} onClick={() => skip.mutate('bad_match')} disabled={busy}>
          Not a good match
        </button>
      )}

      <div className={isPhone ? 'rv-actions bottom' : 'rv-actions'}>
        <button type="button" className="btn btn-p" onClick={openConfirm} disabled={busy || problems.length > 0} aria-describedby={problems.length ? idp + '-problems' : undefined}>
          {submit.isPending ? <span className="spinner" /> : null}
          {sendLabel}
        </button>
        <button type="button" className="btn" onClick={copyAndOpen} disabled={busy}>
          {isPhone ? 'Copy and open job' : 'Copy reply and open job'}
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

      <div>
        <button
          type="button"
          className="linkbtn"
          style={{ fontSize: 14 }}
          aria-expanded={manualOpen}
          aria-controls={idp + '-manual'}
          onClick={() => {
            setActionErr(null);
            setManualOpen((o) => !o);
          }}
        >
          Already sent it yourself?
        </button>
        {manualOpen && <div style={{ marginTop: 12 }}>{manualPanel}</div>}
      </div>

      {confirming && (
        <Dialog title={simulated ? `Test send this proposal from ${draft.account.name}'s account?` : `Send this proposal from ${draft.account.name}'s Upwork account?`} onClose={() => setConfirming(false)} busy={submit.isPending}>
          <dl className="sumlist">
            <div>
              <dt>Job</dt>
              <dd>{j.title}</dd>
            </div>
            <div>
              <dt>Bid</dt>
              <dd>{bidLabel(bidNum, j.jobType)}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{duration || 'Not set'}</dd>
            </div>
            {questions.length > 0 && (
              <div>
                <dt>Screening answers</dt>
                <dd>{plural(answeredCount, 'answer')}</dd>
              </div>
            )}
            {j.connectsRequired !== null && (
              <div>
                <dt>Connects</dt>
                <dd>{j.connectsRequired}</dd>
              </div>
            )}
          </dl>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5 }}>
            {simulated ? 'This is a test send. Nothing goes to Upwork.' : limitsLine(account) ?? 'It will be sent within the account’s sending limits.'}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button type="button" className="btn btn-p" onClick={() => submit.mutate()} disabled={submit.isPending}>
              {submit.isPending ? <span className="spinner" /> : null}
              {simulated ? 'Test send' : 'Send proposal'}
            </button>
            <button type="button" className="btn btn-q" onClick={() => setConfirming(false)} disabled={submit.isPending}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </DraftFrame>
  );
}

function savedToEdits(s: Saved): DraftEdits {
  return { draft: s.draft, bidAmount: s.bidAmount, duration: s.duration, answers: JSON.parse(s.answers) as DraftEdits['answers'] };
}

/* ---------------- Detail: queued or sending (read-only) ---------------- */

function QueuedDraft({ draft, isPhone, nav, onNextReady }: { draft: Draft; isPhone: boolean; nav: Nav; onNextReady: (() => void) | null }) {
  const qc = useQueryClient();
  const j = draft.job;
  const [err, setErr] = useState<string | null>(null);
  const unqueue = useMutation({
    mutationFn: () => api.unqueueDraft(draft.id),
    onSuccess: (updated) => {
      replaceInCache(qc, updated);
      void qc.invalidateQueries({ queryKey: qk.draftsAll });
      void qc.invalidateQueries({ queryKey: qk.overview });
    },
    onError: (e) => setErr(`Couldn't take it out of the queue: ${errorMessage(e)}.`),
  });

  const via = draft.approvedVia === 'telegram' ? 'Telegram' : 'the app';
  const sending = draft.state === 'sending';
  const status = sending
    ? 'Sending now'
    : `Approved via ${via}${draft.queuedAt ? ' ' + relTime(draft.queuedAt) : ''} · ${draft.waitReason ?? 'next to send'}`;

  return (
    <DraftFrame draft={draft} isPhone={isPhone} nav={nav}>
      <div className="note note-ok" role="status" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {sending ? <span className="spinner" style={{ marginTop: 3 }} /> : <Icon.Check size={18} />}
        <div>
          <div style={{ fontWeight: 600 }}>{status}</div>
          <div style={{ marginTop: 2 }}>
            {draft.sendMode === 'simulated'
              ? `Test send from ${draft.account.name}'s account. Nothing goes to Upwork.`
              : `It will be sent from ${draft.account.name}'s Upwork account, then move to Applied jobs.`}
          </div>
        </div>
      </div>

      <section className="card" aria-label="What will be sent" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 className="h3">What will be sent</h3>
        <dl className="sumlist">
          <div>
            <dt>Bid</dt>
            <dd>{bidLabel(draft.bidAmount, j.jobType)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{draft.duration ?? 'Not set'}</dd>
          </div>
          {j.connectsRequired !== null && (
            <div>
              <dt>Connects</dt>
              <dd>{j.connectsRequired}</dd>
            </div>
          )}
        </dl>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Reply</div>
          <p className="readtext" style={{ maxHeight: 'none' }}>
            {draft.draft}
          </p>
        </div>
        {draft.answers.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Screening answers</div>
            {draft.answers.map((a, i) => (
              <div key={i} style={{ fontSize: 14, lineHeight: 1.5 }}>
                <div className="mut">{a.question}</div>
                <div style={{ whiteSpace: 'pre-line', marginTop: 2 }}>{a.answer || '(no answer)'}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {err && (
        <div className="note note-err" role="alert">
          {err}
        </div>
      )}

      <div className="rv-actions">
        {draft.state === 'queued' && (
          <button type="button" className="btn" onClick={() => unqueue.mutate()} disabled={unqueue.isPending}>
            {unqueue.isPending ? <span className="spinner" /> : null}
            Take out of queue
          </button>
        )}
        {onNextReady && (
          <button type="button" className="btn btn-q" onClick={onNextReady}>
            Review the next draft
            <Icon.Next />
          </button>
        )}
      </div>
      {draft.state === 'queued' && <p className="mut small" style={{ margin: 0 }}>Taking it out of the queue moves it back to Ready so you can edit it.</p>}
    </DraftFrame>
  );
}

/* ---------------- Page ---------------- */

type Notice = { key: string; title: string; simulated: boolean };
type BatchResult = { ok: { id: string; title: string }[]; failed: { id: string; title: string; error: string }[]; simulated: boolean };

export function ReviewPage() {
  usePageTitle('Review drafts');
  useTick();
  const qc = useQueryClient();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [params, setParams] = useSearchParams();
  const [accountId, setAccountId] = useState(params.get('account') ?? '');
  const [sort, setSort] = useState<DraftSort>(params.get('sort') === 'newest' ? 'newest' : 'score');
  const accounts = useAccounts();
  const q = useDrafts(accountId, sort);
  const all = useMemo(() => q.data ?? [], [q.data]);
  const tabParam = params.get('tab');
  const tab: Tab = tabParam === 'sending' || tabParam === 'failed' ? tabParam : 'ready';
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { ready: 0, sending: 0, failed: 0 };
    for (const d of all) c[tabOf(d)]++;
    return c;
  }, [all]);
  const list = useMemo(() => all.filter((d) => tabOf(d) === tab), [all, tab]);
  const selParam = params.get('draft');
  const selDraft = all.find((d) => d.id === selParam) ?? null;
  const selected: Draft | null = selDraft ?? (isPhone || selParam ? null : (list[0] ?? null));
  const selIndex = selected ? list.findIndex((d) => d.id === selected.id) : -1;
  const accountOf = (id: string) => accounts.data?.find((a) => a.id === id);

  const editsRef = useRef<EditsHandle>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [missing, setMissing] = useState<false | 'sent' | 'skipped' | 'unknown'>(false);

  const update = (fn: (p: URLSearchParams) => void, push: boolean) => {
    const next = new URLSearchParams(params);
    fn(next);
    setParams(next, { replace: !push });
  };
  const select = (id: string | null, push = isPhone) =>
    update((p) => {
      if (id) p.set('draft', id);
      else p.delete('draft');
    }, push);
  const setTab = (t: Tab) =>
    update((p) => {
      if (t === 'ready') p.delete('tab');
      else p.set('tab', t);
      p.delete('draft');
    }, false);

  // A link to a specific draft (from Telegram or Home): switch to the tab it's in.
  const handledSel = useRef<string | null>(null);
  useEffect(() => {
    if (!selParam || !q.isSuccess || handledSel.current === selParam) return;
    handledSel.current = selParam;
    if (selDraft) {
      setMissing(false);
      const t = tabOf(selDraft);
      if (t !== tab)
        update((p) => {
          if (t === 'ready') p.delete('tab');
          else p.set('tab', t);
        }, false);
    } else if (accountId) {
      handledSel.current = null;
      setAccountId('');
    } else {
      if (!notices.some((n) => n.key.startsWith(selParam))) {
        setMissing('unknown');
        api
          .draft(selParam)
          .then((d) => setMissing(d.state === 'sent' ? 'sent' : d.state === 'skipped' ? 'skipped' : 'unknown'))
          .catch(() => setMissing('unknown'));
      }
      if (!isPhone) select(null, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selParam, q.isSuccess, selDraft?.id]);

  // Notice drafts that leave the queue because they were sent.
  const queuedBefore = useRef<{ key: string; drafts: Map<string, Draft> } | null>(null);
  const handledLocally = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!q.data) return;
    const key = accountId + '|' + sort;
    const nowQueued = new Map(q.data.filter((d) => d.state === 'queued' || d.state === 'sending').map((d) => [d.id, d]));
    const prev = queuedBefore.current;
    if (prev && prev.key === key) {
      const ids = new Set(q.data.map((d) => d.id));
      const gone = [...prev.drafts.values()].filter((d) => !ids.has(d.id) && !handledLocally.current.has(d.id));
      if (gone.length) {
        // Only announce the ones the server confirms were sent.
        void Promise.all(gone.map((d) => api.draft(d.id).then((x) => (x.state === 'sent' ? d : null)).catch(() => null))).then((sent) => {
          const confirmed = sent.filter((d): d is Draft => d !== null);
          if (confirmed.length) {
            setNotices((n) => [...n, ...confirmed.map((d) => ({ key: d.id + ':' + Date.now(), title: d.job.title, simulated: d.sendMode === 'simulated' }))]);
          }
        });
        void qc.invalidateQueries({ queryKey: qk.overview });
        void qc.invalidateQueries({ queryKey: qk.applicationsAll });
        void qc.invalidateQueries({ queryKey: qk.accounts });
      }
    }
    queuedBefore.current = { key, drafts: nowQueued };
  }, [q.data, accountId, sort, qc]);

  // Sent notices clear themselves after a while.
  useEffect(() => {
    if (!notices.length) return;
    const t = setTimeout(() => setNotices((n) => n.slice(1)), 15_000);
    return () => clearTimeout(t);
  }, [notices]);

  // Only ready drafts can stay ticked.
  const readyIds = useMemo(() => new Set(all.filter((d) => d.state === 'ready').map((d) => d.id)), [all]);
  const ticked = [...checked].filter((id) => readyIds.has(id));
  const tickedDrafts = ticked.map((id) => all.find((d) => d.id === id)!).filter(Boolean);
  const allSimulated = tickedDrafts.length > 0 && tickedDrafts.every((d) => d.sendMode === 'simulated');
  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const batch = useMutation({
    mutationFn: () => {
      const open = editsRef.current;
      const items: SubmitItem[] = ticked.map((id) => (open && open.id === id ? { id, ...open.get() } : { id }));
      return api.submitDrafts(items).then((res) => ({ res, open }));
    },
    onSuccess: ({ res, open }) => {
      const titleOf = (id: string) => all.find((d) => d.id === id)?.job.title ?? 'A draft';
      for (const d of res.drafts) replaceInCache(qc, d);
      if (open && res.results.some((r) => r.id === open.id && r.ok)) open.markSaved();
      setBatchResult({
        ok: res.results.filter((r) => r.ok).map((r) => ({ id: r.id, title: titleOf(r.id) })),
        failed: res.results.filter((r) => !r.ok).map((r) => ({ id: r.id, title: titleOf(r.id), error: r.error ?? 'It could not be approved.' })),
        simulated: allSimulated,
      });
      setChecked(new Set());
      setBatchOpen(false);
      void qc.invalidateQueries({ queryKey: qk.draftsAll });
      void qc.invalidateQueries({ queryKey: qk.overview });
      void qc.invalidateQueries({ queryKey: qk.accounts });
    },
  });

  // After skipping or marking as sent, move to the next draft in this tab (or the previous if it was the last).
  const onDone = (id: string) => {
    handledLocally.current.add(id);
    const i = list.findIndex((d) => d.id === id);
    const next = list[i + 1] ?? list[i - 1] ?? null;
    select(next ? next.id : null, false);
  };

  const showList = !isPhone || !selected;
  const nextReady = all.find((d) => d.state === 'ready' && d.id !== selected?.id) ?? null;
  const nav: Nav = {
    position: selIndex + 1,
    total: list.length,
    onBack: () => select(null, false),
    onNext: selIndex >= 0 ? (list[selIndex + 1] ? () => select(list[selIndex + 1].id, false) : null) : list[0] ? () => select(list[0].id, false) : null,
  };

  const emptyText: Record<Tab, string> = {
    ready: accountId ? 'Nothing is waiting for this account. Try All accounts, or check back later.' : "That's everything for now. New drafts appear here as your appliers find good matches.",
    sending: 'Nothing is waiting to send. Proposals you approve wait here until they go, one at a time within each account’s limits.',
    failed: 'Nothing failed to send.',
  };

  const batchAccounts = Array.from(new Set(tickedDrafts.filter((d) => d.sendMode === 'api').map((d) => d.account.id)));

  return (
    <>
      {showList && (
        <div className="top" style={{ marginBottom: 20 }}>
          <div>
            <h1 className="h1">Review drafts</h1>
            <p className="sub" style={{ color: '#5A706B' }}>
              Read the job, tidy the proposal, then approve it. The app sends each approved proposal from the Upwork account named on it, within that account's limits.
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

      {notices.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }} role="status" aria-live="polite">
          {notices.map((n) => (
            <div key={n.key} className="note note-ok" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <Icon.Check size={18} />
              <span style={{ flex: '1 1 240px' }}>
                {n.simulated ? 'Test send done' : 'Sent'}: {n.title}
              </span>
              <Link to="/applied">Applied jobs</Link>
              <button type="button" className="btn btn-q btn-s" onClick={() => setNotices((x) => x.filter((y) => y.key !== n.key))}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {missing && showList && (
        <div className="note" role="status" style={{ marginBottom: 16 }}>
          {missing === 'sent'
            ? 'That proposal has already been sent. '
            : missing === 'skipped'
              ? 'That draft was skipped. '
              : 'That draft isn\u2019t waiting any more. '}
          {missing !== 'skipped' && <Link to="/applied">See applied jobs</Link>}
        </div>
      )}

      {q.isPending ? (
        <Loading label="Loading drafts" />
      ) : q.isError ? (
        <ErrorState what="drafts" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          {showList && (
            <div role="group" aria-label="Show drafts" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {TABS.map((t) => (
                <button key={t.id} type="button" className={tab === t.id ? 'fp on' : 'fp'} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
                  {t.label}
                  <span className="n">{counts[t.id]}</span>
                  {t.id === 'failed' && counts.failed > 0 && tab !== 'failed' && <span className="sr-only"> need attention</span>}
                </button>
              ))}
            </div>
          )}

          {batchResult && showList && (
            <div className={batchResult.failed.length ? 'note note-warn' : 'note note-ok'} role="status" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {batchResult.ok.length > 0 && (
                <div>
                  <strong>
                    {plural(batchResult.ok.length, 'proposal')} approved.
                  </strong>{' '}
                  {batchResult.ok.length === 1
                    ? batchResult.simulated
                      ? 'It goes through as a test send.'
                      : 'It is in the queue and will be sent within the account’s limits.'
                    : batchResult.simulated
                      ? 'They go through as test sends, one at a time.'
                      : 'They are in the queue and will be sent one at a time, within each account’s limits.'}{' '}
                  <button type="button" className="linkbtn" onClick={() => setTab('sending')}>
                    See Sending
                  </button>
                </div>
              )}
              {batchResult.failed.length > 0 && (
                <div>
                  <strong>{plural(batchResult.failed.length, 'draft needs', 'drafts need')} fixing first:</strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                    {batchResult.failed.map((f) => (
                      <li key={f.id}>
                        <button type="button" className="linkbtn" onClick={() => select(f.id)}>
                          {f.title}
                        </button>
                        : {f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <button type="button" className="btn btn-q btn-s" onClick={() => setBatchResult(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <div className="rv-wrap">
            {showList && (
              <div className="rv-list">
                <ul aria-label={`Drafts: ${TABS.find((t) => t.id === tab)!.label}`} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {list.map((d) => {
                    const on = selected?.id === d.id;
                    const isChecked = checked.has(d.id);
                    return (
                      <li key={d.id} className={'item' + (on ? ' on' : '') + (isChecked ? ' ticked' : '')}>
                        {d.state === 'ready' && (
                          <label className="item-check">
                            <input type="checkbox" checked={isChecked} onChange={() => toggle(d.id)} />
                            <span className="sr-only">Select {d.job.title}</span>
                          </label>
                        )}
                        <button type="button" className="item-main" aria-current={on ? 'true' : undefined} onClick={() => select(d.id)}>
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
                            <ItemState d={d} />
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {list.length === 0 && (
                  <div style={{ padding: '24px 16px', fontSize: 14, lineHeight: 1.5, color: '#47605B' }}>
                    {emptyText[tab]}
                    {tab === 'ready' && (
                      <div style={{ marginTop: 12 }}>
                        <Link to="/appliers">See your appliers</Link>
                      </div>
                    )}
                  </div>
                )}
                {ticked.length > 0 && (
                  <div className="batchbar" role="region" aria-label="Selected drafts">
                    <span style={{ fontWeight: 600 }} aria-live="polite">
                      {ticked.length} selected
                    </span>
                    <button type="button" className="btn btn-q btn-s" onClick={() => setChecked(new Set())}>
                      Clear
                    </button>
                    <button type="button" className="btn btn-gold btn-s" onClick={() => setBatchOpen(true)}>
                      {allSimulated ? 'Test send selected' : 'Submit selected'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {selected &&
              (isEditable(selected) ? (
                <EditableDraft
                  key={selected.id + ':edit'}
                  draft={selected}
                  account={accountOf(selected.account.id)}
                  isPhone={isPhone}
                  nav={nav}
                  onDone={onDone}
                  editsRef={editsRef}
                />
              ) : (
                <QueuedDraft
                  key={selected.id + ':queued'}
                  draft={selected}
                  isPhone={isPhone}
                  nav={nav}
                  onNextReady={
                    nextReady
                      ? () =>
                          update((p) => {
                            p.set('draft', nextReady.id);
                            p.delete('tab');
                          }, false)
                      : null
                  }
                />
              ))}
          </div>
        </>
      )}

      {batchOpen && (
        <Dialog title={allSimulated ? `Test send ${plural(ticked.length, 'proposal')}?` : `Send ${plural(ticked.length, 'proposal')}?`} onClose={() => setBatchOpen(false)} busy={batch.isPending}>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5 }}>Each one is sent from the Upwork account named below. Drafts that still need something are left for you to fix.</p>
          <ul className="batchlist">
            {tickedDrafts.map((d) => (
              <li key={d.id}>
                <div style={{ fontWeight: 600 }}>{d.job.title}</div>
                <div className="mut small" style={{ marginTop: 2 }}>
                  {d.sendMode === 'simulated' ? `Test send, ${d.account.name}'s account` : `${d.account.name}'s Upwork account`} · {bidLabel(d.bidAmount, d.job.jobType)}
                  {d.duration ? ` · ${d.duration}` : ''}
                  {d.job.connectsRequired !== null ? ` · ${plural(d.job.connectsRequired, 'Connect')}` : ''}
                </div>
                {d.problems.length > 0 && <div className="warn small" style={{ marginTop: 2 }}>Needs: {d.problems.join(' ')}</div>}
              </li>
            ))}
          </ul>
          {batchAccounts.map((id) => {
            const a = accountOf(id);
            return a ? (
              <p key={id} style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                {a.name}: {limitsLine(a)}
              </p>
            ) : null;
          })}
          {allSimulated && <p style={{ margin: 0, fontSize: 14 }}>These are test sends. Nothing goes to Upwork.</p>}
          {batch.isError && (
            <div className="note note-err" role="alert">
              Couldn't approve them: {errorMessage(batch.error)}.
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button type="button" className="btn btn-p" onClick={() => batch.mutate()} disabled={batch.isPending}>
              {batch.isPending ? <span className="spinner" /> : null}
              {allSimulated ? 'Test send' : 'Send proposals'}
            </button>
            <button type="button" className="btn btn-q" onClick={() => setBatchOpen(false)} disabled={batch.isPending}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function ItemState({ d }: { d: Draft }) {
  if (d.state === 'sending') return <div className="small ok" style={{ marginTop: 4, fontWeight: 600 }}>Sending now</div>;
  if (d.state === 'queued')
    return (
      <div className="small ok" style={{ marginTop: 4, fontWeight: 600 }}>
        Approved{d.sendMode === 'simulated' ? ', test send' : ''}, waiting to send
      </div>
    );
  if (d.state === 'failed') return <div className="small err-text" style={{ marginTop: 4, fontWeight: 600 }}>Not sent</div>;
  if (d.problems.length) return <div className="small warn" style={{ marginTop: 4 }}>Needs: {d.problems[0].replace(/\.$/, '').toLowerCase()}</div>;
  return null;
}
