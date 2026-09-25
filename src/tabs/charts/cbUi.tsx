// Shared bits for the Spending, LEV and Breakthroughs panels: palettes, tooltip
// HTML helpers, hero stats with a count-up, an honest empty state and a sortable table.

import { animate, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { SearchInput } from '../../components/filters/Filters.tsx';
import type { Tokens } from '../../lib/tokens.ts';
import { ClearFiltersButton } from './common.tsx';
import { nextSort, searchRows, sortRows, type SortState } from './filterModel.ts';

// ── palettes (dataviz reference palette; validated in both modes) ───────────
/**
 * Categorical slots in fixed order: blue, orange, aqua, yellow, magenta, green, violet, red.
 * Adjacent pairs pass CVD ΔE ≥ 8 in both modes (stacks, lines). Spending uses slots 1–5 for companies.
 */
const CAT_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const CAT_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
/** Slot 7 violet: a single-series hue that collides with none of slots 1–5. */
const VIOLET = { dark: '#9085e9', light: '#4a3aa7' };
export const catPalette = (t: Tokens) => (t.theme === 'light' ? CAT_LIGHT : CAT_DARK);
export const violet = (t: Tokens) => VIOLET[t.theme];

/**
 * Single-hue (blue) ordinal ramp, oldest/lowest → newest/highest.
 * Light: step 250 → 700 (light → dark). Dark: step 600 → 100, so the newest step
 * carries the most contrast against the dark surface. Validated with --ordinal
 * for n ≤ 5 (light) / n ≤ 6 (dark); beyond that the legend + tooltip + table carry identity.
 */
const ORD_LIGHT = ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
const ORD_DARK = ['#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];
export function ordinalRamp(n: number, t: Tokens): string[] {
  const s = t.theme === 'light' ? ORD_LIGHT : ORD_DARK;
  if (n <= 0) return [];
  if (n === 1) return [s[s.length - 1]];
  return Array.from({ length: n }, (_, i) => s[Math.round((i * (s.length - 1)) / (n - 1))]);
}

export const alpha = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
};

/** True on phone-width viewports, so charts can shorten axis labels and drop direct labels. */
export function useNarrow(query = '(max-width: 640px)') {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// ── tooltip HTML (labels are untrusted data → always escaped) ───────────────
export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const TT_CSS =
  'border-radius:12px;box-shadow:0 12px 32px -12px rgba(0,0,0,.5);backdrop-filter:blur(8px);max-width:340px;white-space:normal;';

/** Tooltip row: value leads (strong), series label follows, keyed by a short stroke. */
export function ttRow(t: Tokens, color: string, label: string, value: string, opts: { dashed?: boolean; muted?: boolean } = {}) {
  const key = `<span style="display:inline-block;width:12px;height:0;border-top:2px ${opts.dashed ? 'dashed' : 'solid'} ${color};margin-right:8px;vertical-align:middle"></span>`;
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;line-height:1.7${opts.muted ? `;color:${t.text3}` : ''}">
    <span style="color:${opts.muted ? t.text3 : t.text2}">${key}${esc(label)}</span>
    <span style="font-weight:600;color:${opts.muted ? t.text3 : t.text};font-variant-numeric:tabular-nums">${esc(value)}</span></div>`;
}
export const ttHead = (t: Tokens, s: string, sub?: string) =>
  `<div style="font-weight:600;color:${t.text};margin-bottom:4px">${esc(s)}${sub ? `<span style="font-weight:400;color:${t.text3};margin-left:6px">${esc(sub)}</span>` : ''}</div>`;
export const ttNote = (t: Tokens, s: string) => `<div style="margin-top:6px;color:${t.text3};font-size:11px;line-height:1.45">${esc(s)}</div>`;

// ── number formatting ───────────────────────────────────────────────────────
/** $ in billions → "$412B" / "$1.23T" / "$8.4B". */
export const fmtB = (b: number) => {
  const a = Math.abs(b);
  if (a >= 1000) return `$${(b / 1000).toFixed(2)}T`;
  if (a >= 100) return `$${Math.round(b)}B`;
  if (a >= 10) return `$${b.toFixed(1)}B`;
  return `$${b.toFixed(2)}B`;
};
export const fmtPct = (x: number, digits = 0) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(digits)}%`;

// ── hero stats ──────────────────────────────────────────────────────────────
/** Count-up for hero numbers (≤700ms; instant under reduced motion). */
export function CountUp({ value, format }: { value: number; format: (v: number) => string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduce) {
      setShown(value);
      return;
    }
    const c = animate(from.current, value, { duration: 0.7, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setShown(v) });
    from.current = value;
    return () => c.stop();
  }, [value, reduce]);
  return <>{format(shown)}</>;
}

export function HeroStat({ label, value, sub, i = 0, info }: { label: ReactNode; value: ReactNode; sub?: ReactNode; i?: number; info?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: 0.05 * i, ease: 'easeOut' }}
      className="min-w-0 rounded-2xl border border-line bg-surface-2/50 px-4 py-3"
    >
      <div className="kicker mb-1.5 flex items-center gap-1.5">
        {label}
        {info}
      </div>
      <div className="text-[26px] font-semibold leading-none tracking-tight text-ink">{value}</div>
      {sub && <div className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-ink-3">{sub}</div>}
    </motion.div>
  );
}

export function HeroRow({ children }: { children: ReactNode }) {
  // Container query: three across whenever the panel itself is wide enough, whatever its grid span.
  return (
    <div className="@container mb-5">
      <div className="grid grid-cols-1 gap-3 @md:grid-cols-3">{children}</div>
    </div>
  );
}

// ── empty state ─────────────────────────────────────────────────────────────
export function EmptyState({ title, file, children, h = 220 }: { title: ReactNode; file?: string; children?: ReactNode; h?: number }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-2 px-6 py-8 text-center" style={{ minHeight: h }}>
      <div className="mb-2 font-mono text-[18px] leading-none text-ink-3" aria-hidden>
        ∅
      </div>
      <div className="text-[13.5px] font-medium text-ink">{title}</div>
      {file && (
        <div className="mt-1.5 text-[12px] text-ink-3">
          Curated file missing or empty: <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2">{file}</code>
        </div>
      )}
      {children && <div className="mt-2 max-w-md text-[12px] leading-relaxed text-ink-3">{children}</div>}
      <div className="mt-3 text-[11.5px] text-ink-3">
        Then run <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">npm run build:data</code>
      </div>
    </div>
  );
}

/** Honest "filters hid everything" state, with the way back. */
export function FilterEmpty({ onClear, children = 'Nothing matches these filters.', h = 200 }: { onClear: () => void; children?: ReactNode; h?: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-line-2 px-6 py-6 text-center text-[13px] text-ink-3" style={{ minHeight: h }}>
      {children}
      <ClearFiltersButton onClick={onClear} />
    </div>
  );
}

/** Small inline notice (partial data, not a full empty state). */
export function Notice({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-[12px] leading-relaxed text-ink-3">{children}</div>;
}

// ── toggle ──────────────────────────────────────────────────────────────────
export function Toggle({ checked, onChange, children, title }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string }) {
  return (
    <label title={title} className={`inline-flex cursor-pointer select-none items-center gap-2 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${checked ? 'border-line-2 bg-surface-3 text-ink' : 'border-line text-ink-3 hover:text-ink-2'}`}>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={`relative h-3.5 w-6 rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-accent ${checked ? 'bg-accent' : 'bg-surface-3 ring-1 ring-line-2'}`}>
        <motion.span
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full ${checked ? 'bg-accent-ink' : 'bg-ink-3'}`}
          animate={{ left: checked ? 12 : 2 }}
          transition={{ type: 'spring', stiffness: 600, damping: 36 }}
        />
      </span>
      {children}
    </label>
  );
}

// ── sortable table ──────────────────────────────────────────────────────────
export interface Col<T> {
  key: string;
  label: ReactNode;
  /** value used for sorting (string values are also searched) */
  sort?: (r: T) => number | string | null | undefined;
  /** extra searchable text for this column */
  text?: (r: T) => string | null | undefined;
  render: (r: T) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

export function SortTable<T>({
  cols,
  rows,
  rowKey,
  initial,
  maxH = 420,
  caption,
  searchable = true,
}: {
  cols: Col<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  initial?: { key: string; dir: 'asc' | 'desc' };
  maxH?: number;
  caption?: string;
  /** row search box above the table (off when the panel already has its own search) */
  searchable?: boolean;
}) {
  const [sort, setSort] = useState<SortState | null>(initial ?? null);
  const [q, setQ] = useState('');
  const hay = useCallback(
    (r: T) =>
      cols
        .map((c) => {
          if (c.text) return c.text(r) ?? '';
          const v = c.sort?.(r);
          return typeof v === 'string' ? v : '';
        })
        .join(' '),
    [cols],
  );
  const sorted = useMemo(() => {
    const found = searchable ? searchRows(rows, hay, q) : rows;
    const c = sort ? cols.find((x) => x.key === sort.key) : undefined;
    return sort && c?.sort ? sortRows(found, c.sort, sort.dir) : found;
  }, [rows, cols, sort, searchable, hay, q]);
  return (
    <div>
      {searchable && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Search rows…" className="w-full sm:w-64" />
          <span className="text-[11.5px] text-ink-3">
            <span className="font-mono text-ink tnum">{sorted.length}</span>
            {sorted.length !== rows.length && ` / ${rows.length}`} rows
          </span>
        </div>
      )}
      <div className="overflow-auto rounded-xl border border-line" style={{ maxHeight: maxH }}>
        <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur">
            <tr>
              {cols.map((c) => {
                const active = sort?.key === c.key;
                const aria = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none';
                return (
                  <th key={c.key} aria-sort={c.sort ? aria : undefined} className={`border-b border-line px-3 py-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-ink-3 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                    {c.sort ? (
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 uppercase hover:text-ink ${active ? 'text-ink' : ''}`}
                        onClick={() => setSort((s) => nextSort(s, c.key, rows.map(c.sort!).find((v) => v != null)))}
                      >
                        {c.label}
                        <span aria-hidden className="text-[9px]">
                          {active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={rowKey(r)} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                {cols.map((c) => (
                  <td key={c.key} className={`px-3 py-2 align-top text-ink-2 ${c.align === 'right' ? 'text-right tnum' : ''} ${c.className ?? ''}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {!sorted.length && (
              <tr>
                <td colSpan={cols.length} className="px-3 py-6 text-center text-ink-3">
                  {q.trim() ? (
                    <>
                      No rows match “{q.trim()}”.{' '}
                      <button type="button" onClick={() => setQ('')} className="underline decoration-line-2 underline-offset-2 hover:text-ink">
                        Clear search
                      </button>
                    </>
                  ) : (
                    'No rows.'
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ExtLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-ink underline decoration-line-2 underline-offset-2 hover:decoration-ink">
      {children}
    </a>
  );
}

/** Fade the content in whenever `k` changes (view/mode switches). */
export function Swap({ k, children }: { k: string; children: ReactNode }) {
  return (
    <motion.div key={k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: 'easeOut' }}>
      {children}
    </motion.div>
  );
}
