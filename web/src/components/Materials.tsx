import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api/client';
import { qk } from '../api/queries';
import type { Material } from '../api/types';
import { fileSize, plural, shortDate } from '../lib/format';
import { Icon } from './ui';

type Props = { applierId: string | null; materials: Material[] };

function useRefresh(applierId: string | null) {
  const qc = useQueryClient();
  return () => {
    if (applierId) void qc.invalidateQueries({ queryKey: qk.applier(applierId) });
    void qc.invalidateQueries({ queryKey: qk.appliers });
  };
}

function latest(materials: Material[], kind: Material['kind']): Material | null {
  const list = materials.filter((m) => m.kind === kind);
  if (list.length === 0) return null;
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function FilePick({
  id,
  accept,
  label,
  disabled,
  onFile,
}: {
  id: string;
  accept: string;
  label: string;
  disabled?: boolean;
  onFile: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn btn-s" disabled={disabled} onClick={() => ref.current?.click()} aria-controls={id}>
        {label}
      </button>
      <input
        ref={ref}
        id={id}
        type="file"
        accept={accept}
        tabIndex={-1}
        aria-hidden="true"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </>
  );
}

/* ---------- Resume ---------- */
function Resume({ applierId, materials }: Props) {
  const refresh = useRefresh(applierId);
  const resume = latest(materials, 'resume');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const disabled = !applierId;

  const upload = async (f: File) => {
    if (!applierId) return;
    setErr(null);
    setBusy(true);
    try {
      // Replace: upload the new one, then remove the old one so only one resume remains.
      const created = await api.uploadResume(applierId, f);
      if (resume && resume.id !== created.id) await api.deleteMaterial(resume.id).catch(() => undefined);
      refresh();
    } catch (e) {
      setErr(`Couldn't upload the resume: ${errorMessage(e)}.`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!resume || !window.confirm('Remove this resume? Replies will stop using it.')) return;
    setErr(null);
    setBusy(true);
    try {
      await api.deleteMaterial(resume.id);
      refresh();
    } catch (e) {
      setErr(`Couldn't remove the resume: ${errorMessage(e)}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <span className="lbl">Resume</span>
      <div className="file">
        <span className="ficon">
          <Icon.File />
        </span>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          {resume ? (
            <>
              <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{resume.fileName ?? resume.title}</div>
              <div className="mut" style={{ fontSize: 13, marginTop: 2 }}>
                Uploaded {shortDate(resume.createdAt)}, {plural(resume.wordCount, 'word')} read by the AI
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600 }}>No resume yet</div>
              <div className="mut" style={{ fontSize: 13, marginTop: 2 }}>PDF, Word or text file. The AI reads it to mention real past work.</div>
            </>
          )}
        </div>
        {busy && <span className="spinner" role="status" aria-label="Working" />}
        {resume && (
          <button
            type="button"
            className="btn btn-s btn-q"
            aria-expanded={showText}
            aria-controls="resume-text"
            onClick={() => setShowText((v) => !v)}
          >
            Check what it read
          </button>
        )}
        <FilePick id="f-resume" accept=".pdf,.docx,.txt" label={resume ? 'Replace' : 'Upload'} disabled={disabled || busy} onFile={upload} />
        {resume && (
          <button type="button" className="btn btn-s btn-q btn-danger" onClick={remove} disabled={busy}>
            Remove
          </button>
        )}
        {resume && showText && (
          <pre className="readtext" id="resume-text" tabIndex={0} aria-label="Text read from the resume">
            {resume.description || 'No text could be read from this file. Try a PDF exported from Word or Google Docs.'}
          </pre>
        )}
      </div>
      {err && (
        <div className="field-err" role="alert">
          {err}
        </div>
      )}
    </div>
  );
}

/* ---------- Video ---------- */
function Video({ applierId, materials }: Props) {
  const refresh = useRefresh(applierId);
  const video = latest(materials, 'video');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [link, setLink] = useState('');
  const disabled = !applierId;

  const replaceWith = async (fn: () => Promise<Material>) => {
    if (!applierId) return;
    setErr(null);
    setBusy(true);
    try {
      const created = await fn();
      if (video && video.id !== created.id) await api.deleteMaterial(video.id).catch(() => undefined);
      setLinkMode(false);
      setLink('');
      refresh();
    } catch (e) {
      setErr(`Couldn't save the video: ${errorMessage(e)}.`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!video || !window.confirm('Remove the intro video?')) return;
    setErr(null);
    setBusy(true);
    try {
      await api.deleteMaterial(video.id);
      refresh();
    } catch (e) {
      setErr(`Couldn't remove the video: ${errorMessage(e)}.`);
    } finally {
      setBusy(false);
    }
  };

  const name = video ? (video.fileName ?? video.url ?? video.title) : null;
  return (
    <div>
      <span className="lbl">Intro video</span>
      <div className="file">
        <span className="ficon">
          <Icon.Video />
        </span>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          {video ? (
            <>
              <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</div>
              <div className="mut" style={{ fontSize: 13, marginTop: 2 }}>
                {[fileSize(video.sizeBytes), 'Replies will say a video is attached.'].filter(Boolean).join('. ')}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600 }}>No video yet</div>
              <div className="mut" style={{ fontSize: 13, marginTop: 2 }}>Optional. A short intro helps on support and assistant roles.</div>
            </>
          )}
        </div>
        {busy && <span className="spinner" role="status" aria-label="Working" />}
        <button type="button" className="btn btn-s btn-q" aria-expanded={linkMode} onClick={() => setLinkMode((v) => !v)} disabled={disabled || busy}>
          Use a link instead
        </button>
        <FilePick id="f-video" accept="video/*" label={video ? 'Replace' : 'Upload'} disabled={disabled || busy} onFile={(f) => replaceWith(() => api.uploadVideo(applierId as string, f))} />
        {video && (
          <button type="button" className="btn btn-s btn-q btn-danger" onClick={remove} disabled={busy}>
            Remove
          </button>
        )}
        {linkMode && (
          <form
            style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) void replaceWith(() => api.linkVideo(applierId as string, link.trim()));
            }}
          >
            <div style={{ flex: '1 1 240px' }}>
              <label className="lbl" htmlFor="f-video-url">
                Video link
              </label>
              <input className="in" id="f-video-url" type="url" placeholder="https://www.loom.com/share/…" value={link} onChange={(e) => setLink(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-s btn-p" disabled={busy || !link.trim()}>
              Save link
            </button>
          </form>
        )}
      </div>
      {err && (
        <div className="field-err" role="alert">
          {err}
        </div>
      )}
    </div>
  );
}

/* ---------- Portfolio ---------- */
function PortfolioForm({
  initial,
  onSave,
  onCancel,
  busy,
  idPrefix,
}: {
  initial: { title: string; description: string };
  onSave: (v: { title: string; description: string }) => void;
  onCancel: () => void;
  busy: boolean;
  idPrefix: string;
}) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [tried, setTried] = useState(false);
  const titleErr = tried && !title.trim();
  return (
    <form
      className="file"
      style={{ flexDirection: 'column', alignItems: 'stretch' }}
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (title.trim()) onSave({ title: title.trim(), description: description.trim() });
      }}
    >
      <div>
        <label className="lbl" htmlFor={idPrefix + '-t'}>
          Title
        </label>
        <input
          className="in"
          id={idPrefix + '-t'}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={titleErr}
          aria-describedby={titleErr ? idPrefix + '-te' : undefined}
          placeholder="Founder support for a recruitment agency"
        />
        {titleErr && (
          <div className="field-err" id={idPrefix + '-te'}>
            Give it a short title.
          </div>
        )}
      </div>
      <div>
        <label className="lbl" htmlFor={idPrefix + '-d'}>
          What you did
        </label>
        <textarea className="in" id={idPrefix + '-d'} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One or two sentences with real results." />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-s btn-p" disabled={busy}>
          {busy ? <span className="spinner" /> : null}
          Save
        </button>
        <button type="button" className="btn btn-s btn-q" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Portfolio({ applierId, materials }: Props) {
  const refresh = useRefresh(applierId);
  const items = materials.filter((m) => m.kind === 'portfolio').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const disabled = !applierId;

  const run = async (key: string, fn: () => Promise<unknown>, what: string) => {
    setErr(null);
    setBusy(key);
    try {
      await fn();
      refresh();
      return true;
    } catch (e) {
      setErr(`Couldn't ${what}: ${errorMessage(e)}.`);
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span className="lbl" id="l-work">
          Past work the AI can mention
        </span>
        <button type="button" className="btn btn-s btn-q" onClick={() => setAdding(true)} disabled={disabled || adding} aria-expanded={adding}>
          Add past work
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-labelledby="l-work" role="group">
        {adding && applierId && (
          <PortfolioForm
            idPrefix="pf-new"
            initial={{ title: '', description: '' }}
            busy={busy === 'new'}
            onCancel={() => setAdding(false)}
            onSave={async (v) => {
              const ok = await run('new', () => api.addPortfolio(applierId, { ...v, useInProposals: true }), 'add it');
              if (ok) setAdding(false);
            }}
          />
        )}
        {items.map((w) =>
          editing === w.id ? (
            <PortfolioForm
              key={w.id}
              idPrefix={'pf-' + w.id}
              initial={{ title: w.title, description: w.description }}
              busy={busy === w.id}
              onCancel={() => setEditing(null)}
              onSave={async (v) => {
                const ok = await run(w.id, () => api.updateMaterial(w.id, v), 'save it');
                if (ok) setEditing(null);
              }}
            />
          ) : (
            <div key={w.id} className="file" style={{ alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                id={'use-' + w.id}
                checked={w.useInProposals}
                disabled={busy === w.id}
                onChange={(e) => void run(w.id, () => api.updateMaterial(w.id, { useInProposals: e.target.checked }), 'update it')}
                style={{ width: 20, height: 20, margin: '2px 0 0' }}
              />
              <label htmlFor={'use-' + w.id} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                <span style={{ fontWeight: 600, display: 'block' }}>{w.title}</span>
                {w.description && (
                  <span className="mut" style={{ fontSize: 13.5, lineHeight: 1.45, display: 'block', marginTop: 4 }}>
                    {w.description}
                  </span>
                )}
                <span className="sr-only">{w.useInProposals ? ' (used in proposals)' : ' (not used in proposals)'}</span>
              </label>
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" className="btn btn-s btn-q" onClick={() => setEditing(w.id)} aria-label={`Edit ${w.title}`}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-s btn-q btn-danger"
                  aria-label={`Delete ${w.title}`}
                  disabled={busy === w.id}
                  onClick={() => {
                    if (window.confirm(`Delete "${w.title}"?`)) void run(w.id, () => api.deleteMaterial(w.id), 'delete it');
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ),
        )}
        {items.length === 0 && !adding && (
          <div className="file mut" style={{ fontSize: 14 }}>
            {disabled ? 'No past work yet.' : 'No past work yet. Add two or three projects with real results; ticked ones can be mentioned in replies.'}
          </div>
        )}
      </div>
      {err && (
        <div className="field-err" role="alert">
          {err}
        </div>
      )}
    </div>
  );
}

export function Materials(props: Props) {
  return (
    <>
      {!props.applierId && (
        <div className="note" role="note">
          Save the applier first to add files.
        </div>
      )}
      <div className={props.applierId ? undefined : 'disabled-block'} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Resume {...props} />
        <Video {...props} />
        <Portfolio {...props} />
      </div>
    </>
  );
}
