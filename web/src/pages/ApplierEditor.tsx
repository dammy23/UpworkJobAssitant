import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api/client';
import { qk, useAccounts, useApplier, useProviders, useTelegram, useTemplates } from '../api/queries';
import type { Account, ApplierInput, Experience, JobType, Material, Preview, Provider, ProviderId } from '../api/types';
import { DURATIONS } from '../api/types';
import { ChipInput } from '../components/ChipInput';
import { Materials } from '../components/Materials';
import { ErrorState, Loading, Meter, Segmented, Switch } from '../components/ui';
import { numOrNull } from '../lib/format';
import { useDebounced, usePageTitle } from '../lib/hooks';

export const CATEGORIES = [
  'Admin Support',
  'Customer Service',
  'Writing',
  'Translation',
  'Design & Creative',
  'Sales & Marketing',
  'Accounting & Consulting',
  'Legal',
  'Engineering & Architecture',
  'Data Science & Analytics',
  'Web, Mobile & Software Dev',
  'IT & Networking',
];

const EXPERIENCE: { value: Experience; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'entry', label: 'Entry' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'expert', label: 'Expert' },
];
const JOB_TYPES: { value: JobType; label: string }[] = [
  { value: 'any', label: 'Either' },
  { value: 'fixed', label: 'Fixed price' },
  { value: 'hourly', label: 'Hourly' },
];
const TONES: { value: string; label: string; hint: string }[] = [
  { value: 'Direct and specific', label: 'Direct and specific', hint: 'Gets to the point. Good for technical and short-term jobs.' },
  { value: 'Warm', label: 'Warm', hint: 'Friendly and personal. Good for ongoing support roles.' },
  { value: 'Brief', label: 'Brief', hint: 'Three or four sentences. Good when a job already has many proposals.' },
];
const SCHEDULES: { value: number; label: string }[] = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 180, label: '3 hours' },
];

const PROVIDER_BADGE: Record<ProviderId, { text: string; cls: string }> = {
  groq: { text: 'Free tier', cls: 'badge' },
  claude: { text: 'Paid', cls: 'badge badge-paid' },
  openai: { text: 'Paid', cls: 'badge badge-paid' },
  ollama: { text: 'Local', cls: 'badge' },
};

type NumKey = 'minFixedBudget' | 'minHourlyRate' | 'clientMinHireRate' | 'clientMinTotalSpend' | 'maxProposals' | 'bidRate';
const NUM_KEYS: NumKey[] = ['minFixedBudget', 'minHourlyRate', 'clientMinHireRate', 'clientMinTotalSpend', 'maxProposals', 'bidRate'];

function defaults(accountId: string): ApplierInput {
  return {
    name: '',
    upworkAccountId: accountId,
    aiProvider: null,
    active: true,
    category: null,
    roles: [],
    keywords: [],
    excludeKeywords: [],
    jobType: 'any',
    minFixedBudget: null,
    minHourlyRate: null,
    experienceLevel: 'any',
    clientPaymentVerified: true,
    clientMinHireRate: null,
    clientMinTotalSpend: null,
    maxProposals: null,
    excludedCountries: [],
    profileSummary: '',
    tone: 'Warm',
    maxWords: 150,
    bidRate: null,
    drafterInstructions: '',
    scoreThreshold: 70,
    scheduleMinutes: 30,
    telegramEnabled: false,
    defaultDuration: 'Less than 1 month',
  };
}

function pickInput(src: ApplierInput): ApplierInput {
  const d = defaults('');
  const out = { ...d };
  for (const k of Object.keys(d) as (keyof ApplierInput)[]) {
    if (src[k] !== undefined) (out as Record<string, unknown>)[k] = src[k];
  }
  return out;
}

function toneHint(tone: string): string {
  const t = TONES.find((x) => x.value.toLowerCase() === tone.toLowerCase()) ?? TONES.find((x) => tone.toLowerCase().startsWith(x.value.split(' ')[0].toLowerCase()));
  return t?.hint ?? '';
}

function usable(p: Provider) {
  return p.enabled && p.configured;
}

function providerDetail(p: Provider): string {
  if (!p.configured) return p.needsBaseUrl ? 'Add the server address in Settings to use it.' : 'Add an API key in Settings to use it.';
  if (!p.enabled) return 'Turned off in Settings.';
  return p.id === 'ollama' && p.baseUrl ? `${p.model} at ${p.baseUrl}, private and free` : p.model;
}

function defaultDetail(providers: Provider[]): string {
  const live = providers.filter(usable);
  if (live.length === 0) return 'No AI provider is set up yet. Jobs are scored with a simple offline check until you add one.';
  const [first, second] = live;
  return `${first.name}, ${first.model}` + (second ? `, with ${second.name} as the fallback` : '');
}

/* ---------------- Preview ---------------- */

function PreviewPanel({ input, account, enabled }: { input: ApplierInput; account: Account | undefined; enabled: boolean }) {
  const debounced = useDebounced(input, 600);
  const q = useQuery({
    queryKey: ['preview', debounced],
    queryFn: () => api.previewApplier({ ...debounced, name: debounced.name.trim() || 'Preview' }),
    enabled: enabled && Boolean(debounced.upworkAccountId),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });
  const th = input.scoreThreshold;
  const p: Preview | undefined = q.data;
  const below = p ? Math.max(0, p.passed - p.wouldDraft) : 0;

  return (
    <aside className="ed-side" aria-labelledby="h-preview">
      <div className="pv-dark" aria-live="polite" aria-busy={q.isFetching}>
        <h2 id="h-preview" style={{ margin: 0, font: "700 19px/1.25 'Bricolage Grotesque', sans-serif" }}>
          If this had run on the last {p?.sampled ?? 50} jobs
        </h2>
        {!input.upworkAccountId ? (
          <div style={{ color: '#BFD0CB', fontSize: 14, marginTop: 12 }}>Pick an Upwork account to see a preview.</div>
        ) : q.isError && !p ? (
          <div style={{ color: '#F5C2B5', fontSize: 14, marginTop: 12 }}>Couldn't load the preview: {errorMessage(q.error)}.</div>
        ) : !p ? (
          <div style={{ color: '#BFD0CB', fontSize: 14, marginTop: 12 }}>
            <span className="spinner" /> Working it out…
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 16 }}>
              <span style={{ font: "700 52px/1 'Bricolage Grotesque', sans-serif", color: '#F2B632' }}>{p.wouldDraft}</span>
              <span style={{ color: '#DCE6E3', fontSize: 15 }}>{p.wouldDraft === 1 ? 'reply drafted' : 'replies drafted'}</span>
              {q.isFetching && <span className="spinner" style={{ color: '#BFD0CB', marginLeft: 'auto' }} aria-label="Updating" />}
            </div>
            <div style={{ color: '#BFD0CB', fontSize: 14, marginTop: 8 }}>
              {p.passed} passed your rules, {below} scored under {th}.
            </div>
          </>
        )}
      </div>
      {p && p.items.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #D5DDDA', borderRadius: 16, padding: '8px 20px 12px' }}>
          {p.items.map((it, i) => {
            const isDraft = it.outcome === 'draft';
            const mark = it.score !== null && it.outcome !== 'skipped' ? String(it.score) : '×';
            const note =
              it.outcome === 'draft'
                ? 'Would be drafted'
                : it.outcome === 'below'
                  ? it.score !== null
                    ? `Scored under ${th}`
                    : it.reason || 'Not scored yet'
                  : `Skipped: ${it.reason.replace(/^skipped:\s*/i, '')}`;
            return (
              <div className="pv" key={i}>
                <span className={'pvmark' + (isDraft ? ' draft' : '') + (mark === '×' ? ' x' : '')} aria-hidden="true">
                  {mark}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, lineHeight: 1.35 }}>
                    {it.title}
                    {it.score !== null && <span className="sr-only">, score {it.score}</span>}
                  </div>
                  <div className="mut" style={{ fontSize: 13, marginTop: 4 }}>
                    {note}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="mut" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
        {account?.status === 'sample' ? `The preview uses sample jobs until ${account.name}'s API key is approved. ` : ''}
        It updates as you change the rules. Only jobs that were already scored get a number.
      </p>
    </aside>
  );
}

/* ---------------- Form ---------------- */

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="sec" id={id} aria-labelledby={'h-' + id}>
      <div className="sech">
        <h2 className="h2" id={'h-' + id}>
          {title}
        </h2>
        {intro && (
          <p className="mut" style={{ margin: 0, fontSize: 14 }}>
            {intro}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function NumField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div>
      <label className="lbl" htmlFor={id}>
        {label}
      </label>
      <input
        className="in"
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
        aria-describedby={hint ? id + '-h' : undefined}
      />
      {hint && (
        <div className="hint" id={id + '-h'}>
          {hint}
        </div>
      )}
    </div>
  );
}

function EditorForm({
  applierId,
  initial,
  materials,
  accounts,
  providers,
  telegramConfigured,
}: {
  applierId: string | null;
  initial: ApplierInput;
  materials: Material[];
  accounts: Account[];
  providers: Provider[];
  telegramConfigured: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<ApplierInput>(initial);
  const [nums, setNums] = useState<Record<NumKey, string>>(() => {
    const o = {} as Record<NumKey, string>;
    for (const k of NUM_KEYS) o[k] = initial[k] === null ? '' : String(initial[k]);
    return o;
  });
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const acctRef = useRef<HTMLSelectElement>(null);

  const set = <K extends keyof ApplierInput>(k: K, v: ApplierInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setNum = (k: NumKey, v: string) => setNums((n) => ({ ...n, [k]: v }));

  const input: ApplierInput = useMemo(() => {
    const out = { ...form };
    for (const k of NUM_KEYS) out[k] = numOrNull(nums[k]);
    return out;
  }, [form, nums]);

  const initialJson = useMemo(() => JSON.stringify(initial), [initial]);
  const dirty = JSON.stringify(input) !== initialJson;

  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirty]);

  const nameErr = !input.name.trim() ? 'Give the applier a name.' : null;
  const acctErr = !input.upworkAccountId ? 'Pick the Upwork account it searches on.' : null;

  const save = async () => {
    setTried(true);
    setSaveErr(null);
    if (nameErr) return nameRef.current?.focus();
    if (acctErr) return acctRef.current?.focus();
    setSaving(true);
    try {
      const body = { ...input, name: input.name.trim() };
      if (applierId) await api.updateApplier(applierId, body);
      else await api.createApplier(body);
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.appliers }),
        qc.invalidateQueries({ queryKey: qk.overview }),
        qc.invalidateQueries({ queryKey: qk.accounts }),
        applierId ? qc.invalidateQueries({ queryKey: qk.applier(applierId) }) : Promise.resolve(),
      ]);
      navigate('/appliers');
    } catch (e) {
      setSaveErr(errorMessage(e));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!applierId) return;
    if (!window.confirm(`Delete ${input.name || 'this applier'}? Its waiting drafts are removed too. Applied jobs are kept.`)) return;
    setDeleting(true);
    setSaveErr(null);
    try {
      await api.deleteApplier(applierId);
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.appliers }),
        qc.invalidateQueries({ queryKey: qk.overview }),
        qc.invalidateQueries({ queryKey: qk.draftsAll }),
        qc.invalidateQueries({ queryKey: qk.accounts }),
      ]);
      navigate('/appliers');
    } catch (e) {
      setSaveErr(`Couldn't delete it: ${errorMessage(e)}`);
      setDeleting(false);
    }
  };

  const discard = () => {
    if (dirty && !window.confirm('Discard your changes?')) return;
    navigate('/appliers');
  };

  const account = accounts.find((a) => a.id === input.upworkAccountId);
  const thSegs = input.scoreThreshold;

  return (
    <>
      <Link to="/appliers" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, textDecoration: 'none', minHeight: 32 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Appliers
      </Link>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, margin: '6px 0 20px' }}>
        <h1 className="h1">{input.name.trim() || (applierId ? 'Applier' : 'New applier')}</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {applierId && (
            <button type="button" className="btn btn-q btn-danger" onClick={remove} disabled={deleting || saving}>
              {deleting ? <span className="spinner" /> : null}
              Delete
            </button>
          )}
          <button type="button" className="btn btn-q" onClick={discard} disabled={saving}>
            Discard changes
          </button>
          <button type="button" className="btn btn-p" onClick={save} disabled={saving || deleting}>
            {saving ? <span className="spinner" /> : null}
            Save applier
          </button>
        </div>
      </div>
      {saveErr && (
        <div className="note note-err" role="alert" style={{ marginBottom: 16 }}>
          Couldn't save the applier: {saveErr}. Try again.
        </div>
      )}
      {tried && (nameErr || acctErr) && (
        <div className="note note-err" role="alert" style={{ marginBottom: 16 }}>
          Fix the highlighted fields, then save again.
        </div>
      )}

      <nav className="jumps" aria-label="Sections">
        <a className="jump" href="#account">Account</a>
        <a className="jump" href="#look">What to look for</a>
        <a className="jump" href="#pay">Pay and clients</a>
        <a className="jump" href="#you">About you</a>
        <a className="jump" href="#voice">How replies sound</a>
        <a className="jump" href="#ai">AI model</a>
        <a className="jump" href="#schedule">Schedule and alerts</a>
      </nav>

      <div className="ed-cols">
        <form
          className="ed-main"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Section id="account" title="Account" intro="Drafts are written for this person, and you'll submit them from their Upwork login.">
            <div className="grid2">
              <div>
                <label className="lbl" htmlFor="f-name">
                  Applier name
                </label>
                <input
                  ref={nameRef}
                  className="in"
                  id="f-name"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  aria-invalid={tried && Boolean(nameErr)}
                  aria-describedby={tried && nameErr ? 'f-name-e' : undefined}
                  placeholder="Virtual assistant"
                  required
                />
                {tried && nameErr && (
                  <div className="field-err" id="f-name-e">
                    {nameErr}
                  </div>
                )}
              </div>
              <div>
                <label className="lbl" htmlFor="f-acct">
                  Upwork account
                </label>
                <select
                  ref={acctRef}
                  className="in"
                  id="f-acct"
                  value={form.upworkAccountId}
                  onChange={(e) => set('upworkAccountId', e.target.value)}
                  aria-invalid={tried && Boolean(acctErr)}
                  aria-describedby={tried && acctErr ? 'f-acct-e f-acct-h' : 'f-acct-h'}
                  required
                >
                  <option value="">Choose an account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email ? `${a.name} (${a.email})` : a.name}
                    </option>
                  ))}
                </select>
                {tried && acctErr && (
                  <div className="field-err" id="f-acct-e">
                    {acctErr}
                  </div>
                )}
                <div className="hint" id="f-acct-h">
                  Add accounts in <Link to="/settings#accounts">Settings</Link>.
                </div>
              </div>
            </div>
          </Section>

          <Section id="look" title="What to look for" intro="Jobs must mention at least one role title or skill, and none of the excluded words.">
            <div className="grid2">
              <div>
                <label className="lbl" htmlFor="f-cat">
                  Upwork category
                </label>
                <select className="in" id="f-cat" value={form.category ?? ''} onChange={(e) => set('category', e.target.value || null)}>
                  <option value="">Any category</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  {form.category && !CATEGORIES.includes(form.category) && <option value={form.category}>{form.category}</option>}
                </select>
              </div>
              <div>
                <span className="lbl" id="l-exp">
                  Experience level
                </span>
                <Segmented labelledBy="l-exp" value={form.experienceLevel} options={EXPERIENCE} onChange={(v) => set('experienceLevel', v)} />
              </div>
            </div>
            <div>
              <label className="lbl" htmlFor="f-roles">
                Role titles
              </label>
              <ChipInput id="f-roles" values={form.roles} onChange={(v) => set('roles', v)} placeholder="Add a job title" />
            </div>
            <div>
              <label className="lbl" htmlFor="f-kw">
                Skills and tools
              </label>
              <ChipInput id="f-kw" values={form.keywords} onChange={(v) => set('keywords', v)} placeholder="Add a skill or tool" />
            </div>
            <div>
              <label className="lbl" htmlFor="f-ex">
                Skip jobs that mention
              </label>
              <ChipInput id="f-ex" danger values={form.excludeKeywords} onChange={(v) => set('excludeKeywords', v)} placeholder="Add a word or phrase" />
            </div>
          </Section>

          <Section id="pay" title="Pay and clients" intro="Jobs with unknown details still pass. A new client with no hire rate isn't skipped for that alone.">
            <div>
              <span className="lbl" id="l-type">
                Job type
              </span>
              <Segmented labelledBy="l-type" value={form.jobType} options={JOB_TYPES} onChange={(v) => set('jobType', v)} />
            </div>
            <div className="grid2">
              {form.jobType !== 'hourly' && <NumField id="f-fixed" label="Lowest fixed price (USD)" value={nums.minFixedBudget} onChange={(v) => setNum('minFixedBudget', v)} />}
              {form.jobType !== 'fixed' && <NumField id="f-hourly" label="Lowest hourly rate (USD)" value={nums.minHourlyRate} onChange={(v) => setNum('minHourlyRate', v)} />}
              <NumField id="f-hire" label="Client hires at least (%)" value={nums.clientMinHireRate} onChange={(v) => setNum('clientMinHireRate', v)} hint="Of the jobs they post." />
              <NumField id="f-spend" label="Client has spent at least (USD)" value={nums.clientMinTotalSpend} onChange={(v) => setNum('clientMinTotalSpend', v)} />
              <NumField id="f-props" label="Skip when proposals reach" value={nums.maxProposals} onChange={(v) => setNum('maxProposals', v)} />
              <div>
                <label className="lbl" htmlFor="f-ctry">
                  Skip clients in these countries
                </label>
                <ChipInput id="f-ctry" danger values={form.excludedCountries} onChange={(v) => set('excludedCountries', v)} placeholder="Add a country" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Switch on={form.clientPaymentVerified} onChange={(v) => set('clientPaymentVerified', v)} labelledBy="l-ver" />
              <span id="l-ver" style={{ fontSize: 15 }}>
                Only clients with a verified payment method
              </span>
            </div>
          </Section>

          <Section id="you" title="About you" intro="The AI reads these to judge fit and to mention real past work. It never invents experience.">
            <div>
              <label className="lbl" htmlFor="f-about">
                Short profile
              </label>
              <textarea
                className="in"
                id="f-about"
                rows={4}
                value={form.profileSummary}
                onChange={(e) => set('profileSummary', e.target.value)}
                placeholder="Who you are, what you do best, and how you like to work."
              />
            </div>
            <Materials applierId={applierId} materials={materials} />
          </Section>

          <Section id="voice" title="How replies sound">
            <div>
              <span className="lbl" id="l-tone">
                Tone
              </span>
              <Segmented labelledBy="l-tone" value={form.tone} options={TONES} onChange={(v) => set('tone', v)} />
              <div className="hint">{toneHint(form.tone)}</div>
            </div>
            <div className="grid2">
              <div>
                <label className="lbl" htmlFor="f-words">
                  Longest reply: {form.maxWords} words
                </label>
                <input
                  id="f-words"
                  type="range"
                  min={60}
                  max={250}
                  step={10}
                  value={form.maxWords}
                  onChange={(e) => set('maxWords', Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
              <NumField id="f-rate" label="Your hourly rate (USD)" value={nums.bidRate} onChange={(v) => setNum('bidRate', v)} hint="Used as your bid on hourly jobs. You can change it per job." />
            </div>
            <div style={{ maxWidth: 360 }}>
              <label className="lbl" htmlFor="f-duration">
                Usual project duration
              </label>
              <select className="sel" id="f-duration" style={{ width: '100%', minHeight: 44 }} value={form.defaultDuration} onChange={(e) => set('defaultDuration', e.target.value)} aria-describedby="f-duration-h">
                {(DURATIONS as readonly string[]).includes(form.defaultDuration) ? null : <option value={form.defaultDuration}>{form.defaultDuration}</option>}
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <div className="hint" id="f-duration-h">
                Suggested on each proposal; you can change it per job.
              </div>
            </div>
            <div>
              <label className="lbl" htmlFor="f-notes">
                Anything else the AI should do
              </label>
              <textarea className="in" id="f-notes" rows={3} value={form.drafterInstructions} onChange={(e) => set('drafterInstructions', e.target.value)} />
            </div>
          </Section>

          <Section
            id="ai"
            title="AI model"
            intro={
              <>
                Which model scores jobs and writes replies for this applier. Keys and servers are set in <Link to="/settings#ai">Settings</Link>.
              </>
            }
          >
            <div role="radiogroup" aria-label="AI model" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[null, ...providers].map((p) => {
                const id = p ? p.id : null;
                const on = form.aiProvider === id;
                const can = p === null || usable(p);
                const badge = p === null ? null : !can ? { text: 'Not set up', cls: 'badge badge-off' } : PROVIDER_BADGE[p.id];
                return (
                  <label key={id ?? 'default'} className={'opt' + (on ? ' on' : '') + (can ? '' : ' dis')}>
                    <input
                      type="radio"
                      name="ai-model"
                      checked={on}
                      disabled={!can}
                      onChange={() => set('aiProvider', id)}
                    />
                    <span className="radio" aria-hidden="true">
                      <span />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600, display: 'block' }}>{p === null ? 'Use the default' : p.id === 'ollama' ? 'Ollama on your computer' : p.name}</span>
                      <span className="mut" style={{ fontSize: 13.5, display: 'block', marginTop: 3 }}>
                        {p === null ? defaultDetail(providers) : providerDetail(p)}
                      </span>
                    </span>
                    {badge && <span className={badge.cls}>{badge.text}</span>}
                  </label>
                );
              })}
            </div>
            {form.aiProvider && !providers.some((p) => p.id === form.aiProvider && usable(p)) && (
              <div className="note" role="note">
                The model picked for this applier isn't set up any more, so the default order is used until you fix it in Settings.
              </div>
            )}
          </Section>

          <Section id="schedule" title="Schedule and alerts">
            <div>
              <span className="lbl" id="l-every">
                Check for new jobs every
              </span>
              <Segmented labelledBy="l-every" value={form.scheduleMinutes} options={SCHEDULES} onChange={(v) => set('scheduleMinutes', v)} />
            </div>
            <div>
              <label className="lbl" htmlFor="f-th">
                Only draft replies for jobs scoring {form.scoreThreshold} or more
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
                <input
                  id="f-th"
                  type="range"
                  min={40}
                  max={95}
                  step={1}
                  value={form.scoreThreshold}
                  onChange={(e) => set('scoreThreshold', Number(e.target.value))}
                  style={{ flex: '1 1 240px' }}
                />
                <Meter score={thSegs} />
              </div>
              <div className="hint">Lower means more drafts to read. Higher means fewer, closer matches.</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <Switch on={form.telegramEnabled} onChange={(v) => set('telegramEnabled', v)} labelledBy="l-tg" />
              <span id="l-tg" style={{ fontSize: 15 }}>
                Send new drafts to Telegram
              </span>
              {form.telegramEnabled && !telegramConfigured && (
                <span className="hint" style={{ flexBasis: '100%', marginTop: 0 }}>
                  Telegram isn't connected yet. Add a bot in <Link to="/settings#alerts">Settings</Link>.
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Switch on={form.active} onChange={(v) => set('active', v)} labelledBy="l-active" />
              <span id="l-active" style={{ fontSize: 15 }}>
                Applier is on
              </span>
            </div>
          </Section>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-q" onClick={discard} disabled={saving}>
              Discard changes
            </button>
            <button type="submit" className="btn btn-p" disabled={saving || deleting}>
              {saving ? <span className="spinner" /> : null}
              Save applier
            </button>
          </div>
        </form>

        <PreviewPanel input={input} account={account} enabled />
      </div>
    </>
  );
}

/* ---------------- Page ---------------- */

export function ApplierEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const [params] = useSearchParams();
  const templateId = params.get('template');
  const accountParam = params.get('account');

  const accounts = useAccounts();
  const providers = useProviders();
  const telegram = useTelegram();
  const templates = useTemplates();
  const applier = useApplier(id);
  usePageTitle(isNew ? 'New applier' : (applier.data?.name ?? 'Applier'));

  if (accounts.isPending || providers.isPending || (!isNew && applier.isPending) || (isNew && templateId && templates.isPending)) {
    return <Loading label="Loading the applier" />;
  }
  if (accounts.isError) return <ErrorState what="accounts" error={accounts.error} onRetry={() => accounts.refetch()} />;
  if (providers.isError) return <ErrorState what="AI providers" error={providers.error} onRetry={() => providers.refetch()} />;
  if (!isNew && applier.isError) return <ErrorState what="the applier" error={applier.error} onRetry={() => applier.refetch()} />;

  if (isNew && accounts.data.length === 0) {
    return <Navigate to="/settings?needAccount=1#accounts" replace />;
  }

  let initial: ApplierInput;
  let materials: Material[] = [];
  let note: string | null = null;
  if (!isNew && applier.data) {
    initial = pickInput(applier.data);
    materials = applier.data.materials;
  } else {
    const firstAccount = accountParam && accounts.data.some((a) => a.id === accountParam) ? accountParam : accounts.data.length === 1 ? accounts.data[0].id : '';
    initial = defaults(firstAccount);
    if (templateId) {
      const t = templates.data?.find((x) => x.id === templateId);
      if (t) {
        initial = { ...initial, ...t.input, upworkAccountId: t.input.upworkAccountId || firstAccount };
        if (!initial.name) initial.name = t.name;
      } else if (templates.isError) {
        note = `Couldn't load the template: ${errorMessage(templates.error)}. Starting blank.`;
      } else {
        note = "That template wasn't found. Starting blank.";
      }
    }
    if (initial.aiProvider && !providers.data.some((p) => p.id === initial.aiProvider && usable(p))) initial.aiProvider = null;
  }

  return (
    <>
      {note && (
        <div className="note" role="status" style={{ marginBottom: 12 }}>
          {note}
        </div>
      )}
      <EditorForm
        key={id ?? 'new:' + (templateId ?? '')}
        applierId={id ?? null}
        initial={initial}
        materials={materials}
        accounts={accounts.data}
        providers={providers.data}
        telegramConfigured={telegram.data?.configured ?? false}
      />
    </>
  );
}
