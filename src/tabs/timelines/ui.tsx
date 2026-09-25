import type { CSSProperties, ReactNode } from 'react';
import { ActiveFilters, type ActivePill } from '../../components/filters/Filters.tsx';
import { highlightParts } from '../../lib/filters.ts';
import { fmtFlop, fmtUsd, monthYear } from '../../lib/format.ts';
import { useTheme } from '../../lib/tokens.ts';
import type { SortState } from '../charts/filterModel.ts';
import type { MilestoneStatus, PreconditionStatus } from './types.ts';

export { effectiveStatus } from './filters.ts';

// ── Status: colour + icon + label, always together ─────────────────────────
export const MILESTONE_STATUS: Record<MilestoneStatus | 'future', { label: string; icon: string; color: string }> = {
  hit: { label: 'Hit', icon: '✓', color: 'var(--good)' },
  partial: { label: 'Partial', icon: '◐', color: 'var(--warn)' },
  'not-yet': { label: 'Not yet', icon: '○', color: 'var(--text-3)' },
  missed: { label: 'Missed', icon: '✕', color: 'var(--critical)' },
  'n/a': { label: 'Not graded', icon: '·', color: 'var(--text-3)' },
  future: { label: 'Future', icon: '·', color: 'var(--text-3)' },
};

export const PRE_STATUS: Record<PreconditionStatus, { label: string; icon: string; color: string }> = {
  happened: { label: 'Happened', icon: '✓', color: 'var(--good)' },
  partial: { label: 'Partial', icon: '◐', color: 'var(--warn)' },
  'not-yet': { label: 'Not yet', icon: '○', color: 'var(--text-3)' },
  unknown: { label: 'Unrated', icon: '?', color: 'var(--text-3)' },
};


export function StatusBadge({ status }: { status: MilestoneStatus | 'future' }) {
  const s = MILESTONE_STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line-2 px-2 py-0.5 text-[11.5px] font-medium text-ink-2">
      <span aria-hidden className="text-[12px] leading-none" style={{ color: s.color }}>
        {s.icon}
      </span>
      {s.label}
    </span>
  );
}

// ── Diverging lag colours (ahead = cool blue, behind = warm orange, gray midpoint) ──
// Categorical/diverging steps from the dataviz reference palette, selected per mode.
export const PALETTE = {
  dark: { blue: '#3987e5', orange: '#d95926', aqua: '#199e70', yellow: '#c98500' },
  light: { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100' },
} as const;

/** Tab-local CSS vars so SVG and HTML can use the mode-correct diverging poles. */
export function usePaletteVars(): CSSProperties {
  const theme = useTheme();
  const p = PALETTE[theme];
  return { ['--tl-ahead' as string]: p.blue, ['--tl-behind' as string]: p.orange, ['--tl-even' as string]: 'var(--text-3)' };
}

/** Within ±0.5 months reads as "on schedule" (gray midpoint). */
export const lagVar = (m: number | null) => (m == null || Math.abs(m) < 0.5 ? 'var(--tl-even)' : m > 0 ? 'var(--tl-behind)' : 'var(--tl-ahead)');

// ── Small building blocks ──────────────────────────────────────────────────
export function EmptyState({ title, children, className = '' }: { title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-start justify-center gap-1.5 rounded-2xl border border-dashed border-line-2 px-5 py-6 ${className}`}>
      <div className="kicker">{title}</div>
      {children && <div className="text-[13px] leading-relaxed text-ink-2">{children}</div>}
    </div>
  );
}

// ── Filter plumbing ────────────────────────────────────────────────────────
/** One wrapping row of filter controls with the active pills + result count under it. */
export function FilterRow({ children, pills, onClearAll, count, total, noun, className = 'mb-4' }: { children: ReactNode; pills: ActivePill[]; onClearAll: () => void; count?: number; total?: number; noun?: string; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <ActiveFilters pills={pills} onClearAll={onClearAll} count={count} total={total} noun={noun} />
    </div>
  );
}

/** Honest empty result, with the way back. */
export function NoMatches({ onClear, children = 'Nothing matches these filters.' }: { onClear: () => void; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-2 px-5 py-8 text-center text-[13px] text-ink-3">
      {children}
      <button type="button" onClick={onClear} className="rounded-full border border-line-2 px-3 py-1 text-[12px] font-medium text-ink-2 hover:border-accent hover:text-ink">
        Clear filters
      </button>
    </div>
  );
}

/** Clickable, aria-sorted table header cell. */
export function SortTh({ k, sort, onSort, children, className = '' }: { k: string; sort: SortState | null; onSort: (k: string) => void; children: ReactNode; className?: string }) {
  const on = sort?.key === k;
  return (
    <th aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-3 py-2 font-normal ${className}`}>
      <button type="button" onClick={() => onSort(k)} className={`kicker inline-flex items-center gap-1 hover:text-ink ${on ? 'text-ink' : ''}`}>
        {children}
        <span aria-hidden className="text-[9px]">
          {on ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

/** Search hits in ink on a soft accent wash. */
export function Hl({ text, q }: { text: string; q: string }) {
  if (!q.trim()) return <>{text}</>;
  return (
    <>
      {highlightParts(text, q).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-[var(--accent-soft)] px-0.5 text-ink">
            {p.t}
          </mark>
        ) : (
          p.t
        ),
      )}
    </>
  );
}

export const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11.5px] text-ink">{children}</code>;

export function ExtLink({ href, children, className = '' }: { href: string; children?: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`underline decoration-line-2 underline-offset-2 hover:text-ink hover:decoration-ink-3 ${className}`}>
      {children ?? hostOf(href)}
    </a>
  );
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ── Text helpers ───────────────────────────────────────────────────────────
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
/** "March 2027: Algorithmic Breakthroughs" → "Algorithmic Breakthroughs". */
export function shortTitle(title: string, max = 30): string {
  const t = title.replace(new RegExp(`^((early|mid|late)\\s+)?((${MONTHS})\\s+)?\\d{4}:\\s*`, 'i'), '').trim();
  return clip(t, max);
}
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:(]+$/, '')}…`;
}

/** Scenario dates carry a precision; say it the way the scenario does. */
export function fmtScenarioDate(date: string, precision?: string | null): string {
  const [y, m] = date.split('-').map(Number);
  if (precision === 'year') return String(y);
  if (precision === 'quarter') {
    // Early / Mid / Late windows are dated at their final month (Apr, Aug, Dec).
    const w = m <= 4 ? 'Early' : m <= 8 ? 'Mid' : 'Late';
    return `${w} ${y}`;
  }
  if (precision === 'half') return `${m <= 6 ? 'H1' : 'H2'} ${y}`;
  return monthYear(date);
}

const METRIC_LABEL: Record<string, string> = {
  osworld: 'OSWorld',
  sweBenchVerified: 'SWE-bench Verified',
  revenueAnnualized: 'Annualized revenue',
  revenueAnnual: 'Annual revenue',
  valuation: 'Valuation',
  trainingFlop: 'Training compute',
  rdMultiplier: 'AI R&D multiplier',
  leadMonths: 'Lead over rivals',
  frontierLagMonths: 'China lag',
};
export const metricLabel = (m: string) =>
  METRIC_LABEL[m] ??
  m
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\bai\b/gi, 'AI')
    .replace(/^./, (c) => c.toUpperCase());

/** Formats a scenario claim by what its metric name says it measures. */
export function fmtClaim(metric: string, value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value == null ? '—' : String(value);
  const m = metric.toLowerCase();
  if (/revenue|valuation|capex|cost|spending/.test(m)) return fmtUsd(value);
  if (/flop/.test(m)) return `${fmtFlop(value)} FLOP`;
  if (/multiplier|reduction|advantage|speedmultiple/.test(m)) return `${value.toLocaleString()}×`;
  if (/share|pct|osworld|swebench|mostimportant/.test(m)) return `${value}%`;
  if (/months/.test(m)) return `${value} mo`;
  if (/gw$/.test(m)) return `${value} GW`;
  if (/approval/.test(m)) return `${value > 0 ? '+' : ''}${value} net`;
  return value.toLocaleString();
}
