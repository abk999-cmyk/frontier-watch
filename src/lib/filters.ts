/** Pure filter predicates + summaries shared by every filterable view. */

export type DateMode = 'any' | 'before' | 'after' | 'between';
export interface DateFilterValue {
  mode: DateMode;
  from?: string; // ISO YYYY-MM-DD (after / between start)
  to?: string; // ISO YYYY-MM-DD (before / between end)
}
export const ANY_DATE: DateFilterValue = { mode: 'any' };

export interface RangeValue {
  min?: number;
  max?: number;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MON[m - 1]} ${d}, ${y}`;
};

/** Inclusive date match. "before X" includes X; "after X" includes X. */
export function matchDate(iso: string | undefined | null, f: DateFilterValue): boolean {
  if (f.mode === 'any') return true;
  if (!iso) return false;
  const d = iso.slice(0, 10);
  if (f.mode === 'before') return !f.to || d <= f.to;
  if (f.mode === 'after') return !f.from || d >= f.from;
  return (!f.from || d >= f.from) && (!f.to || d <= f.to);
}

export function isDateActive(f: DateFilterValue) {
  return f.mode !== 'any' && !!(f.from || f.to);
}

export function summarizeDate(f: DateFilterValue): string {
  if (!isDateActive(f)) return 'Any time';
  if (f.mode === 'before') return `Before ${fmtDay(f.to!)}`;
  if (f.mode === 'after') return `After ${fmtDay(f.from!)}`;
  if (f.from && f.to) return `${fmtDay(f.from)} – ${fmtDay(f.to)}`;
  return f.from ? `From ${fmtDay(f.from)}` : `Until ${fmtDay(f.to!)}`;
}

export function inRange(n: number | undefined | null, r: RangeValue): boolean {
  if (r.min === undefined && r.max === undefined) return true;
  if (n === undefined || n === null || Number.isNaN(n)) return false;
  return (r.min === undefined || n >= r.min) && (r.max === undefined || n <= r.max);
}

export const isRangeActive = (r: RangeValue) => r.min !== undefined || r.max !== undefined;

/** Empty selection = no constraint. Matches if any of the item's values is selected. */
export function matchAny(values: string | string[] | undefined | null, selected: string[]): boolean {
  if (!selected.length) return true;
  if (values === undefined || values === null) return false;
  const arr = Array.isArray(values) ? values : [values];
  return arr.some((v) => selected.includes(v));
}

/** Every whitespace-separated token must appear (case-insensitive) somewhere in the haystack. */
export function textMatch(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const h = haystack.toLowerCase();
  return q.split(/\s+/).every((tok) => h.includes(tok));
}

/** Split text into [plain, match, plain, …] segments for highlighting search hits. */
export function highlightParts(text: string, query: string): { t: string; hit: boolean }[] {
  const toks = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (!toks.length) return [{ t: text, hit: false }];
  const re = new RegExp(`(${toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text
    .split(re)
    .filter(Boolean)
    .map((t) => ({ t, hit: toks.includes(t.toLowerCase()) }));
}

/** Facet counts: how many items carry each value (for option badges). */
export function countBy<T>(items: T[], key: (item: T) => string | string[] | undefined | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k === undefined || k === null) continue;
    for (const v of Array.isArray(k) ? k : [k]) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return m;
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

// ── Calendar helpers ──────────────────────────────────────────────────────
export const isoOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const todayIso = () => new Date().toISOString().slice(0, 10);
export function addMonths(iso: string, n: number): string {
  const [y, m] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return isoOf(Math.floor(total / 12), total % 12, 1);
}
export function addDays(iso: string, n: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + n * 864e5;
  return new Date(t).toISOString().slice(0, 10);
}

/** 6×7 grid of ISO dates (or null padding) for a month, weeks starting Monday. */
export function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0 = Sun
  const offset = (first + 6) % 7; // Monday-first
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let d = 1; d <= days; d++) cells.push(isoOf(year, month, d));
  while (cells.length % 7) cells.push(null);
  return cells;
}
