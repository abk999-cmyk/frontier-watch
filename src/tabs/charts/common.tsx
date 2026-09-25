import { memo, useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { LabGroup } from '../../../shared/types.ts';
import { EChart } from '../../charts/EChart.tsx';
import { ActiveFilters, FilterButton, SearchInput, type ActivePill } from '../../components/filters/Filters.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { textMatch } from '../../lib/filters.ts';
import { isoFromTime, monthYear } from '../../lib/format.ts';
import { LAB_META } from '../../lib/labs.ts';
import type { Tokens } from '../../lib/tokens.ts';
import { nextSort, searchRows, sortRows, type SortState, type SortValue } from './filterModel.ts';

/**
 * EChart re-applies its option whenever it re-renders (tokens are re-read each render), so a
 * memoised wrapper keeps charts from re-initialising when unrelated parent state changes.
 * Pass a `useCallback` option builder and a `useMemo` onEvents map.
 */
export const Chart = memo(EChart);

export const CHART_FONT_MONO = "'Geist Mono Variable', ui-monospace, monospace";

// ── Colour / format helpers ────────────────────────────────────────────────

/** Hex (#rgb/#rrggbb) or rgb() colour → rgba() with the given alpha. */
export function alpha(color: string, a: number): string {
  const c = color.trim();
  if (c.startsWith('#')) {
    const h = c.length === 4 ? c.slice(1).replace(/./g, (x) => x + x) : c.slice(1, 7);
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(',').map((s) => s.trim());
    return `rgba(${r},${g},${b},${a})`;
  }
  return c;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape data-derived strings before they go into ECharts' HTML tooltips. */
export const esc = (s: string | number | undefined | null) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const monthOf = (t: number) => monthYear(isoFromTime(t));

/** METR-style horizons that can run far past a month when projected. */
export function fmtHorizon(min: number): string {
  if (!Number.isFinite(min)) return '∞';
  const h = min / 60;
  if (h < 48) {
    if (min < 1) return `${Math.round(min * 60)}s`;
    if (min < 60) return `${min < 10 ? min.toFixed(1) : Math.round(min)} min`;
    return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  }
  const d = h / 24;
  if (d < 7) return `${d.toFixed(1)} d`;
  if (d < 60) return `${+(d / 7).toFixed(1)} wk`;
  const mo = d / 30.44;
  if (mo < 24) return `${mo.toFixed(1)} mo`;
  const y = d / 365.25;
  if (y < 1000) return `${y < 10 ? y.toFixed(1) : Math.round(y)} yr`;
  return `${y.toExponential(0).replace('e+', 'e')} yr`;
}

export const fmtUsdShort = (v: number) => {
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  if (v >= 100) return `$${Math.round(v)}`;
  if (v >= 1) return `$${v.toFixed(v >= 10 ? 0 : 1)}`;
  if (v >= 0.01) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(1)}`;
};

export const fmtTokens = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : `${Math.round(v)}`);

/** "3.5×" / "120×" / "≫1000×" for decline/growth factors. */
export function fmtFactor(f: number): string {
  if (!Number.isFinite(f)) return '—';
  if (f >= 1000) return '≫1000×';
  if (f >= 100) return `${Math.round(f)}×`;
  if (f >= 10) return `${f.toFixed(0)}×`;
  return `${f.toFixed(1)}×`;
}

// ── ECharts building blocks ────────────────────────────────────────────────

export const labSymbol = (g: LabGroup) => LAB_META[g].shape;

/** Glyph + label row used at the top of tooltips (identity by glyph, never by text colour). */
export function tipHead(t: Tokens, g: LabGroup | null, title: string, sub?: string) {
  const glyph = g ? `<span style="color:${t.lab[g]};font-size:11px;margin-right:6px">${LAB_META[g].glyph}</span>` : '';
  return `<div style="font-weight:600;color:${t.text}">${glyph}${esc(title)}</div>${sub ? `<div style="color:${t.text3};font-size:11px;margin-top:1px">${esc(sub)}</div>` : ''}`;
}

export function tipRows(t: Tokens, rows: [string, string][]) {
  return `<div style="margin-top:6px;display:grid;grid-template-columns:auto auto;gap:2px 14px;font-size:11.5px">${rows
    .map(([k, v]) => `<span style="color:${t.text3}">${esc(k)}</span><span style="color:${t.text};font-family:${CHART_FONT_MONO};text-align:right">${esc(v)}</span>`)
    .join('')}</div>`;
}

export const tipHint = (t: Tokens, s: string) => `<div style="margin-top:6px;color:${t.text3};font-size:10.5px">${esc(s)}</div>`;

/** Inside + slider zoom on the x axis, styled from tokens. */
export function xZoom(t: Tokens, fmt: (v: number) => string = monthOf) {
  return [
    { type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: 'shift', moveOnMouseWheel: false, moveOnMouseMove: true },
    {
      type: 'slider',
      xAxisIndex: 0,
      filterMode: 'none',
      height: 18,
      bottom: 10,
      left: 56,
      right: 28,
      borderColor: t.line,
      backgroundColor: 'transparent',
      fillerColor: alpha(t.accent, 0.1),
      dataBackground: { lineStyle: { color: t.line2, width: 1 }, areaStyle: { color: alpha(t.text3, 0.08) } },
      selectedDataBackground: { lineStyle: { color: t.accent, width: 1 }, areaStyle: { color: alpha(t.accent, 0.12) } },
      handleStyle: { color: t.surface3, borderColor: t.line2 },
      moveHandleStyle: { color: t.line2 },
      emphasis: { handleStyle: { borderColor: t.accent }, moveHandleStyle: { color: t.accent } },
      textStyle: { color: t.text3, fontFamily: t.mono, fontSize: 10 },
      labelFormatter: (v: number) => fmt(v),
      brushSelect: false,
    },
  ];
}

// ── Small controls ─────────────────────────────────────────────────────────

export type View = 'chart' | 'table';

export function ViewToggle({ value, onChange, chartLabel = 'Chart' }: { value: View; onChange: (v: View) => void; chartLabel?: string }) {
  return (
    <Segmented<View>
      label="Chart or table"
      value={value}
      onChange={onChange}
      options={[
        { value: 'chart', label: chartLabel },
        { value: 'table', label: 'Table' },
      ]}
    />
  );
}

export interface PickOption<T extends string> {
  value: T;
  label: string;
  /** options sharing a group render under one header */
  group?: string;
  hint?: string;
}

function PickList<T extends string>({ options, value, onPick }: { options: PickOption<T>[]; value: T; onPick: (v: T) => void }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => options.filter((o) => textMatch(`${o.label} ${o.group ?? ''} ${o.hint ?? ''} ${o.value}`, q)), [options, q]);
  let lastGroup: string | undefined;
  return (
    <div>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search…"
        aria-label="Search options"
        className="mb-2 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-ink-3 focus:border-line-2 focus:outline-none"
      />
      <div role="listbox" className="max-h-[320px] overflow-y-auto pr-1">
        {shown.map((o) => {
          const header = o.group && o.group !== lastGroup ? o.group : null;
          lastGroup = o.group;
          const on = o.value === value;
          return (
            <div key={o.value}>
              {header && <div className="kicker mt-2 px-1 pb-1">{header}</div>}
              <button
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => onPick(o.value)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-3 ${on ? 'text-ink' : 'text-ink-2'}`}
              >
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {on && <span className="mr-1.5 text-accent">✓</span>}
                  {o.label}
                </span>
                {o.hint && <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{o.hint}</span>}
              </button>
            </div>
          );
        })}
        {!shown.length && <div className="px-1 py-3 text-center text-ink-3">No matches</div>}
      </div>
    </div>
  );
}

/** Searchable single choice (benchmarks): a filter-kit pill that opens a grouped, type-to-find list. */
export function SearchSelect<T extends string>({ label, value, onChange, options, width = 340, align }: { label: string; value: T; onChange: (v: T) => void; options: PickOption<T>[]; width?: number; align?: 'start' | 'end' }) {
  const cur = options.find((o) => o.value === value);
  // The wrapper lets the trigger shrink (ellipsising the summary) inside narrow containers.
  return (
    <span className="inline-flex min-w-0 max-w-full [&>button]:max-w-full">
      <FilterButton label={label} summary={cur?.label ?? '—'} active={false} width={width} align={align}>
        {(close) => (
          <PickList
            options={options}
            value={value}
            onPick={(v) => {
              onChange(v);
              close();
            }}
          />
        )}
      </FilterButton>
    </span>
  );
}

/** One wrapping row of filter controls with the active pills + result count under it. */
export function FilterRow({
  children,
  pills,
  onClearAll,
  count,
  total,
  noun,
  className = 'mb-3',
}: {
  children: ReactNode;
  pills: ActivePill[];
  onClearAll: () => void;
  count?: number;
  total?: number;
  noun?: string;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <ActiveFilters pills={pills} onClearAll={onClearAll} count={count} total={total} noun={noun} />
    </div>
  );
}

/** The action inside an honest "nothing matches" state. */
export function ClearFiltersButton({ onClick, children = 'Clear filters' }: { onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="mt-2 rounded-full border border-line-2 px-3 py-1 text-[12px] font-medium text-ink-2 hover:border-accent hover:text-ink">
      {children}
    </button>
  );
}

const SLIDER_CSS = `
.fw-range{-webkit-appearance:none;appearance:none;background:transparent;height:18px;width:100%;margin:0}
.fw-range:focus{outline:none}
.fw-range::-webkit-slider-runnable-track{height:3px;border-radius:3px;background:transparent}
.fw-range::-moz-range-track{height:3px;border-radius:3px;background:transparent}
.fw-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;pointer-events:auto;cursor:grab;height:16px;width:16px;border-radius:999px;margin-top:-6.5px;background:var(--surface-3);border:2px solid var(--accent);box-shadow:0 0 0 4px color-mix(in oklab,var(--accent) 16%,transparent),0 0 14px -2px var(--accent)}
.fw-range::-moz-range-thumb{pointer-events:auto;cursor:grab;height:12px;width:12px;border-radius:999px;background:var(--surface-3);border:2px solid var(--accent);box-shadow:0 0 0 4px color-mix(in oklab,var(--accent) 16%,transparent)}
.fw-range:active::-webkit-slider-thumb{cursor:grabbing;transform:scale(1.1)}
.fw-range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 5px color-mix(in oklab,var(--accent) 35%,transparent)}
.fw-range.fw-dual{pointer-events:none;position:absolute;inset:0}
`;

/** Injects the slider thumb styles once per document. */
function SliderStyles() {
  useEffect(() => {
    if (document.getElementById('fw-range-css')) return;
    const s = document.createElement('style');
    s.id = 'fw-range-css';
    s.textContent = SLIDER_CSS;
    document.head.appendChild(s);
  }, []);
  return null;
}

function Track({ lo, hi, children }: { lo: number; hi: number; children: ReactNode }) {
  return (
    <div className="relative h-[18px]">
      <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-line-2" />
      <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-accent shadow-[0_0_10px_-1px_var(--accent)]" style={{ left: `${lo * 100}%`, width: `${Math.max(0, hi - lo) * 100}%` }} />
      {children}
    </div>
  );
}

/** Single-thumb slider with a label row and a formatted value readout. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => String(v),
  hint,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: ReactNode;
}) {
  const id = useId();
  const frac = max > min ? (value - min) / (max - min) : 0;
  return (
    <div className="min-w-0">
      <SliderStyles />
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="kicker">
          {label}
        </label>
        <span className="font-mono text-[12px] tnum text-ink">{format(value)}</span>
      </div>
      <Track lo={0} hi={frac}>
        <input id={id} type="range" className="fw-range relative" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      </Track>
      {hint && <div className="mt-1 text-[11px] text-ink-3">{hint}</div>}
    </div>
  );
}

/** Dual-handle range slider (two overlaid native inputs, keyboard accessible). */
export function RangeSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => String(v),
  minGap = step,
}: {
  label: ReactNode;
  value: [number, number];
  min: number;
  max: number;
  step: number;
  onChange: (v: [number, number]) => void;
  format?: (v: number) => string;
  minGap?: number;
}) {
  const [a, b] = value;
  const span = max - min || 1;
  return (
    <div className="min-w-0">
      <SliderStyles />
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="kicker">{label}</span>
        <span className="font-mono text-[12px] tnum text-ink">
          {format(a)} <span className="text-ink-3">→</span> {format(b)}
        </span>
      </div>
      <Track lo={(a - min) / span} hi={(b - min) / span}>
        <input
          aria-label="Window start"
          type="range"
          className="fw-range fw-dual"
          min={min}
          max={max}
          step={step}
          value={a}
          onChange={(e) => onChange([Math.min(Number(e.target.value), b - minGap), b])}
        />
        <input
          aria-label="Window end"
          type="range"
          className="fw-range fw-dual"
          min={min}
          max={max}
          step={step}
          value={b}
          onChange={(e) => onChange([a, Math.max(Number(e.target.value), a + minGap)])}
        />
      </Track>
    </div>
  );
}

// ── Layout helpers ─────────────────────────────────────────────────────────

/** Honest empty state for a chart area. */
export function EmptyState({ title, children, h = 300 }: { title: ReactNode; children?: ReactNode; h?: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-2 px-6 text-center" style={{ minHeight: h }}>
      <div className="text-[13px] font-medium text-ink-2">{title}</div>
      {children && <div className="max-w-md text-[12px] text-ink-3">{children}</div>}
    </div>
  );
}

export interface Column<T> {
  key: string;
  label: ReactNode;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
  /** Sort key; a column without one isn't sortable. String keys are searched too. */
  sort?: (row: T) => SortValue;
  /** Extra searchable text for this column (defaults to a string sort key). */
  text?: (row: T) => string | null | undefined;
}

/** Plain, scrollable data table: the accessibility twin of every chart. Sortable headers and a row search. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  maxHeight = 420,
  caption,
  empty = 'No rows.',
  initialSort = null,
  searchable = true,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T, i: number) => string;
  maxHeight?: number;
  caption?: string;
  empty?: string;
  initialSort?: SortState | null;
  searchable?: boolean;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortState | null>(initialSort);
  const hay = useCallback(
    (r: T) =>
      columns
        .map((c) => {
          if (c.text) return c.text(r) ?? '';
          const v = c.sort?.(r);
          return typeof v === 'string' ? v : '';
        })
        .join(' '),
    [columns],
  );
  const shown = useMemo(() => {
    const found = searchRows(rows, hay, q);
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    return sort && col?.sort ? sortRows(found, col.sort, sort.dir) : found;
  }, [rows, hay, q, sort, columns]);
  if (!rows.length) return <EmptyState title={empty} h={200} />;
  return (
    <div>
      {searchable && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Search rows…" className="w-full sm:w-64" />
          <span className="text-[11.5px] text-ink-3">
            <span className="font-mono text-ink tnum">{shown.length}</span>
            {shown.length !== rows.length && ` / ${rows.length}`} rows
          </span>
        </div>
      )}
      <div className="overflow-auto rounded-xl border border-line" style={{ maxHeight }}>
        <table className="w-full min-w-[520px] border-collapse text-[12px]">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-[1] bg-surface-2">
            <tr>
              {columns.map((c) => {
                const on = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={c.sort ? (on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                    className={`whitespace-nowrap border-b border-line px-3 py-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-3 ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                  >
                    {c.sort ? (
                      <button
                        type="button"
                        onClick={() => setSort((s) => nextSort(s, c.key, rows.map(c.sort!).find((v) => v != null)))}
                        className={`inline-flex items-center gap-1 uppercase tracking-[0.08em] hover:text-ink ${on ? 'text-ink' : ''}`}
                      >
                        {c.label}
                        <span aria-hidden className="text-[9px]">
                          {on ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
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
            {shown.map((r, i) => (
              <tr key={rowKey(r, i)} className="border-b border-line/60 last:border-0 hover:bg-surface-3/40">
                {columns.map((c) => (
                  <td key={c.key} className={`whitespace-nowrap px-3 py-1.5 text-ink-2 ${c.align === 'right' ? 'text-right font-mono tnum text-ink' : ''}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-ink-3">
                  No rows match “{q.trim()}”.{' '}
                  <button type="button" onClick={() => setQ('')} className="underline decoration-line-2 underline-offset-2 hover:text-ink">
                    Clear search
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Lab identity cell: coloured glyph + ink label. */
export function LabCell({ g, children }: { g: LabGroup; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[10px]" style={{ color: `var(--lab-${g})` }}>
        {LAB_META[g].glyph}
      </span>
      {children ?? LAB_META[g].label}
    </span>
  );
}

/** Compact instrument readout (mono kicker, big value, small sub). */
export function Readout({ label, value, sub, accent = false }: { label: ReactNode; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-2/50 px-3 py-2.5">
      <div className="kicker mb-1 truncate">{label}</div>
      <div className={`truncate text-[18px] font-semibold leading-tight tracking-tight ${accent ? 'text-aurora' : 'text-ink'}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

/** Tracks whether the user prefers reduced motion (live). */
export function useReducedMotion() {
  const [r, setR] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setR(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return r;
}
