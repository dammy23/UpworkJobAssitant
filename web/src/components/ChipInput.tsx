import { useState, type KeyboardEvent } from 'react';

/** Chip input: Enter or comma adds, × removes, Backspace on empty removes the last chip. */
export function ChipInput({
  id,
  values,
  onChange,
  placeholder,
  danger = false,
  describedBy,
}: {
  id: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  danger?: boolean;
  describedBy?: string;
}) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const lower = new Set(values.map((v) => v.toLowerCase()));
    const next = [...values];
    for (const p of parts) {
      if (!lower.has(p.toLowerCase())) {
        next.push(p);
        lower.add(p.toLowerCase());
      }
    }
    onChange(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
      setDraft('');
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="chips" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
      {values.map((v, i) => (
        <span key={v + i} className={danger ? 'chip chip-x' : 'chip'}>
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange(values.filter((_, j) => j !== i));
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="chipin"
        id={id}
        value={draft}
        placeholder={placeholder}
        aria-describedby={describedBy}
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(',')) {
            add(v);
            setDraft('');
          } else setDraft(v);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (draft.trim()) {
            add(draft);
            setDraft('');
          }
        }}
      />
    </div>
  );
}
