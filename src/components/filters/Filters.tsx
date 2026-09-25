import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addDays,
  addMonths,
  ANY_DATE,
  isDateActive,
  isRangeActive,
  summarizeDate,
  todayIso,
  type DateFilterValue,
  type DateMode,
  type RangeValue,
} from '../../lib/filters.ts';
import { Calendar } from './Calendar.tsx';
import { Popover } from './Popover.tsx';

/* ───────────────────────────── Trigger pill ───────────────────────────── */

export function FilterButton({
  label,
  summary,
  active,
  children,
  width = 300,
  align = 'start',
  icon,
}: {
  label: string;
  summary?: ReactNode;
  active: boolean;
  children: (close: () => void) => ReactNode;
  width?: number;
  align?: 'start' | 'end';
  icon?: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-8 max-w-[320px] items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors ${
          active ? 'border-[color-mix(in_oklab,var(--accent)_55%,transparent)] bg-[var(--accent-soft)] text-ink' : 'border-line bg-surface-2/60 text-ink-2 hover:border-line-2 hover:text-ink'
        } ${open ? 'border-line-2 text-ink' : ''}`}
      >
        {icon}
        <span className="shrink-0 font-medium">{label}</span>
        {summary && (
          <>
            <span className="text-ink-3">·</span>
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{summary}</span>
          </>
        )}
        <span className={`ml-0.5 text-[9px] text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} width={width} align={align}>
        {children(() => setOpen(false))}
      </Popover>
    </>
  );
}

/* ───────────────────────────── Multi-select ───────────────────────────── */

export interface Option {
  value: string;
  label: string;
  count?: number;
  color?: string;
  glyph?: string;
  group?: string;
  hint?: string;
}

export function MultiSelectList({ options, value, onChange, searchable }: { options: Option[]; value: string[]; onChange: (v: string[]) => void; searchable?: boolean }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => `${o.label} ${o.hint ?? ''} ${o.group ?? ''}`.toLowerCase().includes(s)) : options;
  }, [options, q]);
  const sel = new Set(value);
  const toggle = (v: string) => onChange(sel.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  let lastGroup: string | undefined;
  return (
    <div>
      {(searchable ?? options.length > 8) && (
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          className="mb-2 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-ink-3 focus:border-line-2 focus:outline-none"
        />
      )}
      <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] text-ink-3">
        <span>{value.length ? `${value.length} selected` : 'Any'}</span>
        <span className="flex gap-2">
          <button type="button" className="hover:text-ink" onClick={() => onChange([...new Set([...value, ...shown.map((o) => o.value)])])}>
            Select {q ? 'shown' : 'all'}
          </button>
          <button type="button" className="hover:text-ink" onClick={() => onChange(q ? value.filter((v) => !shown.some((o) => o.value === v)) : [])}>
            Clear
          </button>
        </span>
      </div>
      <div className="max-h-[300px] overflow-y-auto pr-1">
        {shown.map((o) => {
          const header = o.group && o.group !== lastGroup ? o.group : null;
          lastGroup = o.group;
          const checked = sel.has(o.value);
          return (
            <div key={o.value}>
              {header && <div className="kicker mt-2 px-1 pb-1">{header}</div>}
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-3">
                <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[9px] ${checked ? 'border-[var(--accent)] bg-accent text-accent-ink' : 'border-line-2'}`}>{checked ? '✓' : ''}</span>
                <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggle(o.value)} />
                {o.color && (
                  <span className="text-[10px]" style={{ color: o.color }}>
                    {o.glyph ?? '●'}
                  </span>
                )}
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-ink">{o.label}</span>
                {o.hint && <span className="shrink-0 text-[11px] text-ink-3">{o.hint}</span>}
                {o.count !== undefined && <span className="shrink-0 font-mono text-[10.5px] text-ink-3 tnum">{o.count}</span>}
              </label>
            </div>
          );
        })}
        {!shown.length && <div className="px-1 py-3 text-center text-ink-3">No matches</div>}
      </div>
    </div>
  );
}

export function MultiSelect({ label, options, value, onChange, width = 300, align, searchable }: { label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void; width?: number; align?: 'start' | 'end'; searchable?: boolean }) {
  const summary = value.length === 0 ? undefined : value.length === 1 ? options.find((o) => o.value === value[0])?.label ?? value[0] : `${value.length} selected`;
  return (
    <FilterButton label={label} summary={summary} active={value.length > 0} width={width} align={align}>
      {() => <MultiSelectList options={options} value={value} onChange={onChange} searchable={searchable} />}
    </FilterButton>
  );
}

/* ───────────────────────────── Single select ───────────────────────────── */

export function SingleSelect<T extends string>({ label, options, value, onChange, defaultValue, width = 240 }: { label: string; options: { value: T; label: string; hint?: string }[]; value: T; onChange: (v: T) => void; defaultValue?: T; width?: number }) {
  const cur = options.find((o) => o.value === value);
  return (
    <FilterButton label={label} summary={cur?.label} active={defaultValue !== undefined && value !== defaultValue} width={width}>
      {(close) => (
        <div className="space-y-0.5">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => (onChange(o.value), close())}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-3 ${o.value === value ? 'text-ink' : 'text-ink-2'}`}
            >
              <span>
                {o.value === value && <span className="mr-1.5 text-accent">✓</span>}
                {o.label}
              </span>
              {o.hint && <span className="text-[11px] text-ink-3">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </FilterButton>
  );
}

/* ───────────────────────────── Date filter ───────────────────────────── */

export interface DatePreset {
  label: string;
  value: DateFilterValue;
}

export function defaultDatePresets(): DatePreset[] {
  const t = todayIso();
  const y = Number(t.slice(0, 4));
  return [
    { label: 'Last 30 days', value: { mode: 'after', from: addDays(t, -30) } },
    { label: 'Last 3 months', value: { mode: 'after', from: addMonths(t, -3) } },
    { label: 'Last 6 months', value: { mode: 'after', from: addMonths(t, -6) } },
    { label: 'Last 12 months', value: { mode: 'after', from: addMonths(t, -12) } },
    { label: `This year (${y})`, value: { mode: 'between', from: `${y}-01-01`, to: `${y}-12-31` } },
    { label: String(y - 1), value: { mode: 'between', from: `${y - 1}-01-01`, to: `${y - 1}-12-31` } },
    { label: String(y - 2), value: { mode: 'between', from: `${y - 2}-01-01`, to: `${y - 2}-12-31` } },
    { label: 'Since o1 (Sep 2024)', value: { mode: 'after', from: '2024-09-12' } },
    { label: 'Since GPT-4 (Mar 2023)', value: { mode: 'after', from: '2023-03-14' } },
  ];
}

const DATE_MODES: { value: DateMode; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'before', label: 'Before' },
  { value: 'after', label: 'After' },
  { value: 'between', label: 'Between' },
];

export function DatePanel({ value, onChange, marks, presets = defaultDatePresets(), minYear, onDone }: { value: DateFilterValue; onChange: (v: DateFilterValue) => void; marks?: Set<string>; presets?: DatePreset[]; minYear?: number; onDone?: () => void }) {
  const [mode, setMode] = useState<DateMode>(value.mode === 'any' ? 'between' : value.mode);
  const pick = (iso: string) => {
    if (mode === 'before') onChange({ mode, to: iso });
    else if (mode === 'after') onChange({ mode, from: iso });
    else if (mode === 'between') {
      // First click sets the start, second sets the end (order-independent).
      if (value.mode !== 'between' || !value.from || (value.from && value.to)) onChange({ mode, from: iso, to: undefined });
      else onChange(iso < value.from ? { mode, from: iso, to: value.from } : { mode, from: value.from, to: iso });
    }
  };
  const setField = (k: 'from' | 'to', v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && onChange({ ...value, mode: mode === 'any' ? 'between' : mode, [k]: v });
  const cur = value.mode === mode ? value : { mode };
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="flex shrink-0 flex-row flex-wrap gap-1 sm:w-[150px] sm:flex-col">
        {presets.map((p) => (
          <button key={p.label} type="button" onClick={() => (onChange(p.value), setMode(p.value.mode))} className="rounded-lg px-2 py-1 text-left text-[12px] text-ink-2 hover:bg-surface-3 hover:text-ink">
            {p.label}
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-3 inline-flex rounded-full border border-line bg-surface p-0.5">
          {DATE_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => {
                setMode(m.value);
                if (m.value === 'any') onChange(ANY_DATE);
              }}
              className={`rounded-full px-2.5 py-0.5 text-[12px] ${mode === m.value ? 'bg-accent font-medium text-accent-ink' : 'text-ink-2 hover:text-ink'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {mode !== 'any' && (
          <>
            <Calendar range={mode === 'between'} from={mode === 'before' ? cur.to : cur.from} to={mode === 'between' ? cur.to : undefined} onPick={pick} marks={marks} minYear={minYear} months={mode === 'between' ? 2 : 1} />
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
              {mode !== 'before' && (
                <label className="flex items-center gap-1.5">
                  {mode === 'between' ? 'From' : 'On/after'}
                  <input type="date" value={cur.from ?? ''} onChange={(e) => setField('from', e.target.value)} className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-ink [color-scheme:inherit]" />
                </label>
              )}
              {mode !== 'after' && (
                <label className="flex items-center gap-1.5">
                  {mode === 'between' ? 'To' : 'On/before'}
                  <input type="date" value={cur.to ?? ''} onChange={(e) => setField('to', e.target.value)} className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-ink [color-scheme:inherit]" />
                </label>
              )}
              {marks && <span className="inline-flex items-center gap-1"><span className="h-1 w-1 rounded-full bg-[var(--glow-b)]" /> has entries</span>}
            </div>
          </>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={() => onChange(ANY_DATE)} className="rounded-full border border-line px-3 py-1 text-[12px] text-ink-2 hover:text-ink">
            Reset
          </button>
          {onDone && (
            <button type="button" onClick={onDone} className="rounded-full bg-accent px-3 py-1 text-[12px] font-medium text-accent-ink">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function DateFilter({ label = 'Date', value, onChange, marks, presets, minYear }: { label?: string; value: DateFilterValue; onChange: (v: DateFilterValue) => void; marks?: Set<string>; presets?: DatePreset[]; minYear?: number }) {
  return (
    <FilterButton label={label} summary={isDateActive(value) ? summarizeDate(value) : undefined} active={isDateActive(value)} width={720}>
      {(close) => <DatePanel value={value} onChange={onChange} marks={marks} presets={presets} minYear={minYear} onDone={close} />}
    </FilterButton>
  );
}

/* ───────────────────────────── Numeric range ───────────────────────────── */

export function RangePanel({ domain, value, onChange, step = 1, format = String }: { domain: [number, number]; value: RangeValue; onChange: (v: RangeValue) => void; step?: number; format?: (n: number) => string }) {
  const [lo, hi] = domain;
  const a = value.min ?? lo;
  const b = value.max ?? hi;
  const pct = (n: number) => ((n - lo) / (hi - lo || 1)) * 100;
  const set = (min: number, max: number) => onChange({ min: min <= lo ? undefined : min, max: max >= hi ? undefined : max });
  return (
    <div className="px-1 pt-1">
      <div className="relative h-6">
        <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-surface-3" />
        <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` }} />
        {[a, b].map((v, i) => (
          <input
            key={i}
            type="range"
            min={lo}
            max={hi}
            step={step}
            value={v}
            aria-label={i ? 'Maximum' : 'Minimum'}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (i === 0) set(Math.min(n, b), b);
              else set(a, Math.max(n, a));
            }}
            className="range-thumb pointer-events-none absolute inset-0 w-full appearance-none bg-transparent"
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
        <input type="number" value={a} step={step} min={lo} max={hi} onChange={(e) => set(Number(e.target.value), b)} className="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-ink tnum" aria-label="Minimum value" />
        <span className="text-ink-3">
          {format(a)} – {format(b)}
        </span>
        <input type="number" value={b} step={step} min={lo} max={hi} onChange={(e) => set(a, Number(e.target.value))} className="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right text-ink tnum" aria-label="Maximum value" />
      </div>
    </div>
  );
}

export function RangeFilter({ label, domain, value, onChange, step, format = String }: { label: string; domain: [number, number]; value: RangeValue; onChange: (v: RangeValue) => void; step?: number; format?: (n: number) => string }) {
  const summary = isRangeActive(value) ? `${format(value.min ?? domain[0])}–${format(value.max ?? domain[1])}` : undefined;
  return (
    <FilterButton label={label} summary={summary} active={isRangeActive(value)} width={300}>
      {() => (
        <div>
          <RangePanel domain={domain} value={value} onChange={onChange} step={step} format={format} />
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={() => onChange({})} className="rounded-full border border-line px-3 py-1 text-[12px] text-ink-2 hover:text-ink">
              Reset
            </button>
          </div>
        </div>
      )}
    </FilterButton>
  );
}

/* ───────────────────────────── Toggle + search ───────────────────────────── */

export function ToggleFilter({ label, value, onChange, title }: { label: ReactNode; value: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={value}
      title={title}
      onClick={() => onChange(!value)}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors ${
        value ? 'border-[color-mix(in_oklab,var(--accent)_55%,transparent)] bg-[var(--accent-soft)] text-ink' : 'border-line bg-surface-2/60 text-ink-2 hover:border-line-2 hover:text-ink'
      }`}
    >
      <span className={`flex h-3 w-5 items-center rounded-full p-px transition-colors ${value ? 'bg-accent' : 'bg-surface-3'}`}>
        <span className={`h-2.5 w-2.5 rounded-full bg-[var(--text)] transition-transform ${value ? 'translate-x-2 bg-[var(--accent-ink)]' : ''}`} />
      </span>
      {label}
    </button>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className = '' }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <label className={`relative inline-flex h-8 items-center ${className}`}>
      <span className="pointer-events-none absolute left-3 text-[12px] text-ink-3">⌕</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-full border border-line bg-surface-2/60 pl-7 pr-7 text-[12.5px] text-ink placeholder:text-ink-3 focus:border-line-2 focus:outline-none"
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="absolute right-2.5 text-[11px] text-ink-3 hover:text-ink">
          ✕
        </button>
      )}
    </label>
  );
}

/* ───────────────────────────── Active pills ───────────────────────────── */

export interface ActivePill {
  key: string;
  label: ReactNode;
  onClear: () => void;
}

export function ActiveFilters({ pills, onClearAll, count, total, noun = 'results' }: { pills: ActivePill[]; onClearAll: () => void; count?: number; total?: number; noun?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
      {count !== undefined && (
        <span className="mr-1 text-ink-2">
          <span className="font-mono font-semibold text-ink tnum">{count.toLocaleString()}</span>
          {total !== undefined && count !== total && <span className="text-ink-3"> / {total.toLocaleString()}</span>} {noun}
        </span>
      )}
      {pills.map((p) => (
        <button key={p.key} type="button" onClick={p.onClear} className="group inline-flex items-center gap-1 rounded-full border border-line bg-surface-2/60 px-2 py-0.5 text-ink-2 hover:border-line-2 hover:text-ink" title="Remove filter">
          {p.label}
          <span className="text-[10px] text-ink-3 group-hover:text-ink">✕</span>
        </button>
      ))}
      {pills.length > 1 && (
        <button type="button" onClick={onClearAll} className="ml-1 text-ink-3 underline decoration-line-2 underline-offset-2 hover:text-ink">
          Clear all
        </button>
      )}
    </div>
  );
}
