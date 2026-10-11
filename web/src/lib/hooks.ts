import { useEffect, useRef, useState } from 'react';

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Job Assistant` : 'Job Assistant';
  }, [title]);
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Re-renders every `ms` so relative times stay fresh. */
export function useTick(ms = 60_000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [m, setM] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

export const PHONE_QUERY = '(max-width: 760px)';

/** A message that clears itself after a while. */
export function useFlash(ms = 8000) {
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (text: string, tone: 'ok' | 'err' = 'ok') => {
    if (timer.current) clearTimeout(timer.current);
    setMsg({ text, tone });
    timer.current = setTimeout(() => setMsg(null), ms);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return [msg, show, () => setMsg(null)] as const;
}
