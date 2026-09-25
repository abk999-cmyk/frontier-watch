import { use, useEffect, useRef, useState, type ReactNode } from 'react';
import { load } from '../../lib/data.ts';
import { highlightParts } from '../../lib/filters.ts';
import { monogram } from './classify.ts';
import { KIND_META, type Kind, type RefsData } from './types.ts';

/** references.json, loaded once (call under <Suspense>). */
export const useRefs = () => use(load<RefsData>('references'));

/** Favicon-free host mark: two letters on a neutral tile. */
export function Monogram({ host, size = 'md' }: { host: string; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-10 w-10 rounded-xl text-[12.5px]' : size === 'sm' ? 'h-6 w-6 rounded-md text-[9.5px]' : 'h-8 w-8 rounded-lg text-[10.5px]';
  return (
    <span aria-hidden className={`inline-flex shrink-0 select-none items-center justify-center border border-line-2 bg-surface-3 font-mono font-semibold tracking-wide text-ink-2 ${box}`}>
      {monogram(host)}
    </span>
  );
}

export function KindBadge({ kind, className = '' }: { kind: Kind; className?: string }) {
  const m = KIND_META[kind];
  return (
    <span title={m.hint} className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-line px-1.5 py-px text-[10.5px] text-ink-2 ${className}`}>
      <span className="text-[9.5px] text-ink-3">{m.glyph}</span>
      {m.short}
    </span>
  );
}

/** Search-hit highlighting (text stays ink; hits get a soft accent wash). */
export function Hi({ text, q }: { text: string; q: string }) {
  if (!q.trim()) return <>{text}</>;
  return (
    <>
      {highlightParts(text, q).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-[3px] bg-[var(--accent-soft)] px-px text-inherit">
            {p.t}
          </mark>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </>
  );
}

export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle');
  const t = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(t.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('done');
    } catch {
      setState('fail');
    }
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setState('idle'), 1600);
  };
  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] transition-colors ${
        state === 'done' ? 'border-[color-mix(in_oklab,var(--accent)_55%,transparent)] bg-[var(--accent-soft)] text-ink' : 'border-line text-ink-2 hover:border-line-2 hover:text-ink'
      } ${className}`}
    >
      <span aria-hidden className="text-[10px]">{state === 'done' ? '✓' : state === 'fail' ? '!' : '⧉'}</span>
      <span aria-live="polite">{state === 'done' ? 'Copied' : state === 'fail' ? 'Select & copy' : label}</span>
    </button>
  );
}

export function Ext({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={`underline decoration-line-2 underline-offset-2 hover:text-ink hover:decoration-[var(--text-3)] ${className}`}>
      {children}
    </a>
  );
}

/** "https://www.example.com/a/b/" → "example.com/a/b" for compact display. */
export const displayUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

export const fmtDay = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
