import type { ReactNode } from 'react';
import { errorMessage } from '../api/client';

/* ---------- Icons (from the designs) ---------- */
type IconProps = { size?: number; className?: string; strokeWidth?: number };
const base = (size: number, sw: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: sw,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className,
});

export const Icon = {
  Check: ({ size = 18, className, strokeWidth = 2.4 }: IconProps) => (
    <svg {...base(size, strokeWidth, className)}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
  ),
  Home: ({ size = 18, className }: IconProps) => (
    <svg {...base(size, 1.8, className)}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>
  ),
  Inbox: ({ size = 18, className }: IconProps) => (
    <svg {...base(size, 1.8, className)}><path d="M4 13h4l2 3h4l2-3h4" /><path d="M5 5h14l1 8v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6z" /></svg>
  ),
  Sliders: ({ size = 18, className }: IconProps) => (
    <svg {...base(size, 1.8, className)}>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" />
    </svg>
  ),
  Applied: ({ size = 18, className }: IconProps) => (
    <svg {...base(size, 1.8, className)}><path d="M9 11l3 3 8-8" /><path d="M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11" /></svg>
  ),
  Settings: ({ size = 18, className }: IconProps) => (
    <svg {...base(size, 1.8, className)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </svg>
  ),
  Warn: ({ size = 20, className }: IconProps) => (
    <svg {...base(size, 2, className)}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
  ),
  Flag: ({ size = 18, className }: IconProps) => (
    <svg {...base(size, 2.2, className)}><path d="M12 8v5M12 16.5h.01" /><circle cx="12" cy="12" r="9" /></svg>
  ),
  External: ({ size = 14, className }: IconProps) => (
    <svg {...base(size, 2, className)}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
  ),
  Refresh: ({ size = 14, className }: IconProps) => (
    <svg {...base(size, 2, className)}><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
  ),
  Clip: ({ size = 16, className }: IconProps) => (
    <svg {...base(size, 1.8, className)}><path d="M21 12.5 12.6 21a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></svg>
  ),
  Plus: ({ size = 16, className }: IconProps) => (
    <svg {...base(size, 2.2, className)}><path d="M12 5v14M5 12h14" /></svg>
  ),
  PlusCircle: ({ size = 22, className }: IconProps) => (
    <svg {...base(size, 1.8, className)}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>
  ),
  Back: ({ size = 16, className }: IconProps) => (
    <svg {...base(size, 2, className)}><path d="M15 18l-6-6 6-6" /></svg>
  ),
  Next: ({ size = 16, className }: IconProps) => (
    <svg {...base(size, 2, className)}><path d="M9 6l6 6-6 6" /></svg>
  ),
  Up: ({ size = 16, className }: IconProps) => (
    <svg {...base(size, 2, className)}><path d="M6 15l6-6 6 6" /></svg>
  ),
  Down: ({ size = 16, className }: IconProps) => (
    <svg {...base(size, 2, className)}><path d="M6 9l6 6 6-6" /></svg>
  ),
  Download: ({ size = 16, className }: IconProps) => (
    <svg {...base(size, 2, className)}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
  ),
  File: ({ size = 20, className }: IconProps) => (
    <svg {...base(size, 1.8, className)}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>
  ),
  Video: ({ size = 20, className }: IconProps) => (
    <svg {...base(size, 1.8, className)}><rect x="3" y="5" width="13" height="14" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></svg>
  ),
};

/* ---------- Fit meter ---------- */
export function Meter({ score, segments = 10, mini = false }: { score: number; segments?: number; mini?: boolean }) {
  const filled = Math.max(0, Math.min(segments, Math.round(score / (100 / segments))));
  return (
    <span className={mini ? 'meter mini' : 'meter'} aria-hidden="true">
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={i < filled ? 'seg f' : 'seg'} />
      ))}
    </span>
  );
}

/* ---------- Account avatar ---------- */
const AV_COLORS = ['#2E6B60', '#7A4FB0', '#B0563C', '#2F6C9E', '#8A6A12', '#A0446E'];
export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}
export function Avatar({ id, name, size = 20 }: { id: string; name: string; size?: 20 | 22 | 24 | 36 | 40 }) {
  const sizeCls = size === 20 ? '' : ` av-${size}`;
  return (
    <span className={'av' + sizeCls} style={{ background: avatarColor(id) }} aria-hidden="true">
      {(name.trim().charAt(0) || '?').toUpperCase()}
    </span>
  );
}

/* ---------- Switch ---------- */
export function Switch({
  on,
  onChange,
  label,
  labelledBy,
  disabled,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  labelledBy?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={on ? 'sw sw-on' : 'sw sw-off'}
      aria-pressed={on}
      aria-label={label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className={on ? 'kn kn-on' : 'kn kn-off'} />
    </button>
  );
}

/* ---------- Segmented control ---------- */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  labelledBy,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  labelledBy: string;
}) {
  return (
    <div className="segc" role="group" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={o.value === value ? 'on' : ''}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Loading / error / empty ---------- */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="state-box" role="status" aria-live="polite">
      <span className="spinner" /> <span style={{ marginLeft: 8 }}>{label}…</span>
    </div>
  );
}

export function ErrorState({ what, error, onRetry }: { what: string; error: unknown; onRetry?: () => void }) {
  return (
    <div className="note note-err" role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
      <span style={{ flex: '1 1 240px' }}>
        Couldn't load {what}: {errorMessage(error)}.
      </span>
      {onRetry && (
        <button type="button" className="btn btn-s" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function InlineError({ error, prefix }: { error: unknown; prefix: string }) {
  if (!error) return null;
  return (
    <div className="note note-err" role="alert">
      {prefix}: {errorMessage(error)}.
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2 className="h3">{title}</h2>
      {children}
    </div>
  );
}

export function SrOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
