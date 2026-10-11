import type { AppStatus } from '../api/types';

export const STATUS_ORDER: AppStatus[] = ['applied', 'viewed', 'replied', 'interview', 'hired', 'declined'];

export const STATUS_LABEL: Record<AppStatus, string> = {
  applied: 'Sent',
  viewed: 'Viewed',
  replied: 'Replied',
  interview: 'Interview',
  hired: 'Hired',
  declined: 'Declined',
};

export const STATUS_COLOR: Record<AppStatus, string> = {
  applied: '#B7C5C1',
  viewed: '#E8C25A',
  replied: '#3F8FAE',
  interview: '#5B4BC4',
  hired: '#2E9A62',
  declined: '#D9826E',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "12 min ago", "1 hr ago", "3 days ago", "9 Oct". */
export function relTime(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parse(iso);
  if (!d) return 'never';
  const sec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day} days ago`;
  return shortDate(iso);
}

/** "9 Oct", with the year added when it isn't this year. */
export function shortDate(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parse(iso);
  if (!d) return '';
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "Today, 9:40", "Yesterday", or "4 Oct". */
export function changeDate(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parse(iso);
  if (!d) return '';
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return `Today, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  return shortDate(iso, now);
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return '$' + n.toLocaleString('en-US');
}

export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? one + 's')}`;
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
/** "Five" for headlines; digits above ten. */
export function countWord(n: number): string {
  return n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

export function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Splits the server's reasons / red flags text into bullet lines. */
export function splitLines(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

export function fileSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Parses a number input. Empty string means null. */
export function numOrNull(v: string): number | null {
  const t = v.trim().replace(/[,$%]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
