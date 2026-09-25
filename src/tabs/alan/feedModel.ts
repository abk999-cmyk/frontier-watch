// Pure derivations for the Countdown tab's evidence log (no React).
// Merges Alan's AGI countdown log and ASI evidence log into one stream, works out
// which entries actually moved the needle, detects the labs/companies each entry
// mentions, and buckets entries by month for the histogram.

import type { AgiData, AsiData, AsiItem, AsiStatus, LabGroup } from '../../../shared/types.ts';
import { countBy, hostOf, inRange, isRangeActive, matchAny, matchDate, textMatch, type DateFilterValue, type RangeValue } from '../../lib/filters.ts';

/* ───────────────────────────── Lab / company mentions ───────────────────────────── */

export type LabKind = 'Frontier labs' | 'Chinese labs' | 'Big tech' | 'Robotics & BCI' | 'Research';
export const LAB_KIND_ORDER: LabKind[] = ['Frontier labs', 'Chinese labs', 'Big tech', 'Robotics & BCI', 'Research'];

export interface LabDef {
  key: string;
  label: string;
  /** Colour identity (the dashboard's lab palette). Everything outside the big four + Chinese labs is `other`. */
  group: LabGroup;
  kind: LabKind;
  re: RegExp;
}

// Case-sensitive on purpose: "Meta", "Figure", "Helix" and "o3" are ordinary words in lower case.
export const LAB_DEFS: LabDef[] = [
  { key: 'openai', label: 'OpenAI', group: 'openai', kind: 'Frontier labs', re: /\bOpenAI\b|\bChatGPT\b|\bGPT\b|\bCodex\b|\bSora\b|(?<![\w-])o[134](?=[\s,.;:)\]/?-]|$)/ },
  { key: 'anthropic', label: 'Anthropic', group: 'anthropic', kind: 'Frontier labs', re: /\bAnthropic\b|\bClaude\b/ },
  { key: 'google', label: 'Google / DeepMind', group: 'google', kind: 'Frontier labs', re: /\bGoogle\b|\bGemini\b|\bDeepMind\b|\bGemma\b|\bGDM\b|\bAlpha(?:Fold|Evolve|Proof|Geometry|Go|Zero|Dev|Tensor|Chip|Code|Star|Qubit|Genome)\b|\bTPU/ },
  { key: 'xai', label: 'xAI', group: 'xai', kind: 'Frontier labs', re: /\bxAI\b|\bGrok\b/ },
  { key: 'meta', label: 'Meta', group: 'other', kind: 'Frontier labs', re: /\bMeta\b(?![- ]analys)|\bLlama\b|\bMuse Spark\b|\bFAIR\b/ },
  { key: 'mistral', label: 'Mistral', group: 'other', kind: 'Frontier labs', re: /\bMistral\b/ },
  { key: 'deepseek', label: 'DeepSeek', group: 'china', kind: 'Chinese labs', re: /\bDeepSeek\b/i },
  { key: 'qwen', label: 'Qwen / Alibaba', group: 'china', kind: 'Chinese labs', re: /\bQwen|\bAlibaba\b/ },
  { key: 'moonshot', label: 'Moonshot / Kimi', group: 'china', kind: 'Chinese labs', re: /\bMoonshot\b|\bKimi\b/ },
  { key: 'zhipu', label: 'Zhipu / GLM', group: 'china', kind: 'Chinese labs', re: /\bZhipu\b|\bGLM\b|\bZ\.ai\b/ },
  { key: 'minimax', label: 'MiniMax', group: 'china', kind: 'Chinese labs', re: /\bMiniMax\b/ },
  { key: 'microsoft', label: 'Microsoft', group: 'other', kind: 'Big tech', re: /\bMicrosoft\b|\bCopilot\b|\bAzure\b/ },
  { key: 'nvidia', label: 'NVIDIA', group: 'other', kind: 'Big tech', re: /\bNVIDIA\b|\bNvidia\b/ },
  { key: 'amazon', label: 'Amazon', group: 'other', kind: 'Big tech', re: /\bAmazon\b|\bAWS\b/ },
  { key: 'apple', label: 'Apple', group: 'other', kind: 'Big tech', re: /\bApple\b/ },
  { key: 'figure', label: 'Figure', group: 'other', kind: 'Robotics & BCI', re: /\bFigure(?= AI\b|’s\b|'s\b| 0?\d\b| Helix\b)|\bHelix\b/ },
  { key: 'tesla', label: 'Tesla / Optimus', group: 'other', kind: 'Robotics & BCI', re: /\bTesla\b|\bOptimus\b/ },
  { key: 'bostondynamics', label: 'Boston Dynamics', group: 'other', kind: 'Robotics & BCI', re: /\bBoston Dynamics\b/ },
  { key: 'unitree', label: 'Unitree', group: 'other', kind: 'Robotics & BCI', re: /\bUnitree\b/ },
  { key: '1x', label: '1X', group: 'other', kind: 'Robotics & BCI', re: /(?<![\w.])1X\b/ },
  { key: 'apptronik', label: 'Apptronik', group: 'other', kind: 'Robotics & BCI', re: /\bApptronik\b/ },
  { key: 'agility', label: 'Agility Robotics', group: 'other', kind: 'Robotics & BCI', re: /\bAgility\b/ },
  { key: 'neuralink', label: 'Neuralink', group: 'other', kind: 'Robotics & BCI', re: /\bNeuralink\b/ },
  { key: 'sakana', label: 'Sakana AI', group: 'other', kind: 'Research', re: /\bSakana\b/ },
];
export const LAB_BY_KEY = new Map(LAB_DEFS.map((d) => [d.key, d]));

/** Lab/company keys mentioned in a piece of text, in LAB_DEFS order. */
export function detectLabs(text: string): string[] {
  if (!text) return [];
  return LAB_DEFS.filter((d) => d.re.test(text)).map((d) => d.key);
}

/* ───────────────────────────── Links ───────────────────────────── */

const HOST_ALIAS: Record<string, string> = {
  'youtu.be': 'youtube.com',
  'm.youtube.com': 'youtube.com',
  'twitter.com': 'x.com',
  'mobile.twitter.com': 'x.com',
  'archive.li': 'archive.md',
  'archive.is': 'archive.md',
  'archive.ph': 'archive.md',
};

/** Link host for facets: no www, no trailing dot, a few mirrors merged (youtu.be → youtube.com, twitter → x). */
export function normHost(url: string): string {
  const h = hostOf(url).replace(/\.$/, '').toLowerCase();
  return HOST_ALIAS[h] ?? h;
}

/* ───────────────────────────── Entries ───────────────────────────── */

export type Source = 'agi' | 'asi';
export type EntryType = 'agi-pct' | 'agi-info' | 'asi';
/** `first` = first evidence for the indicator (it became partial); `achieved` = this entry made it achieved. */
export type IndicatorChange = 'first' | 'achieved';

export const SOURCE_LABEL: Record<Source, string> = { agi: 'AGI countdown', asi: 'ASI checklist' };
export const TYPE_LABEL: Record<EntryType, string> = { 'agi-pct': 'AGI % move', 'agi-info': 'AGI info', asi: 'ASI evidence' };
export const PHASE_LABEL: Record<number, string> = { 1: 'Discovery & simulation', 2: 'Governance & economy', 3: 'Physical world' };

export interface IndicatorRef {
  id: number;
  status: Exclude<AsiStatus, 'none'>;
  change: IndicatorChange | null;
  label: string;
  keyword: string;
  phase: number | null;
  type: string | null;
}

export interface FeedLink {
  label: string;
  url: string;
  host: string;
}

export interface FeedEntry {
  id: string;
  source: Source;
  type: EntryType;
  /** ISO YYYY-MM-DD (Alan logs by month, so the day is always 01). */
  date: string;
  /** YYYY-MM */
  month: string;
  /** Chronological rank across the merged stream, 0 = oldest. */
  order: number;
  title: string;
  summary: string;
  links: FeedLink[];
  hosts: string[];
  labs: string[];
  /** AGI % entries only. */
  pct: number | null;
  prevPct: number | null;
  delta: number | null;
  /** ASI entries only. */
  indicators: IndicatorRef[];
  asiChange: 'status' | 'evidence' | null;
  /** AGI: % rose vs the previous % entry. ASI: at least one indicator changed status. */
  moved: boolean;
  /** Lower-cased haystack for text search. */
  search: string;
}

/** Items in chronological order. Alan's logs are newest-first, so within one date a higher index is older. */
function chrono<T extends { date: string }>(list: T[]): { item: T; idx: number }[] {
  return list.map((item, idx) => ({ item, idx })).sort((a, b) => (a.item.date ?? '').localeCompare(b.item.date ?? '') || b.idx - a.idx);
}

/** Some AGI entries have no title: promote the first sentence of the summary. */
export function splitTitle(title: string, summary: string): { title: string; summary: string } {
  const t = (title ?? '').trim();
  const s = (summary ?? '').trim();
  if (t) return { title: t, summary: s };
  const m = s.match(/^(.{8,160}?[.!?])(?:\s+|$)(.*)$/s);
  if (m) return { title: m[1], summary: m[2].trim() };
  if (s.length <= 140) return { title: s, summary: '' };
  return { title: `${s.slice(0, 120).replace(/\s+\S*$/, '')}…`, summary: s };
}

const RANK: Record<AsiStatus, number> = { none: 0, partial: 1, achieved: 2 };

/**
 * Status before each ASI log entry = the best of (a) Alan's status events from strictly
 * earlier months and (b) earlier log entries. An indicator in an entry is a status change
 * when it had no evidence before (→ `first`) or the entry marks it achieved for the first
 * time (→ `achieved`).
 */
export function asiChanges(log: AsiData['log'], events: AsiData['events'] = []): Map<number, Map<number, IndicatorChange | null>> {
  const firstEvent = new Map<number, string>();
  const achievedEvent = new Map<number, string>();
  for (const e of events ?? []) {
    for (const id of e.ids ?? []) {
      if (!firstEvent.has(id) || e.date < firstEvent.get(id)!) firstEvent.set(id, e.date);
      if (e.achieved && (!achievedEvent.has(id) || e.date < achievedEvent.get(id)!)) achievedEvent.set(id, e.date);
    }
  }
  const seen = new Map<number, number>();
  const out = new Map<number, Map<number, IndicatorChange | null>>();
  for (const { item, idx } of chrono(log)) {
    const per = new Map<number, IndicatorChange | null>();
    for (const ref of item.ids ?? []) {
      const now = RANK[ref.status] ?? 0;
      const a = achievedEvent.get(ref.id);
      const f = firstEvent.get(ref.id);
      const fromEvents = a && a < item.date ? 2 : f && f < item.date ? 1 : 0;
      const before = Math.max(fromEvents, seen.get(ref.id) ?? 0);
      per.set(ref.id, now === 2 && before < 2 ? 'achieved' : now >= 1 && before === 0 ? 'first' : null);
      seen.set(ref.id, Math.max(before, now));
    }
    out.set(idx, per);
  }
  return out;
}

const linksOf = (links: { label: string; url: string }[] | undefined): FeedLink[] =>
  (links ?? []).filter((l) => l && l.url).map((l) => ({ label: (l.label ?? '').trim() || normHost(l.url) || 'link', url: l.url, host: normHost(l.url) }));

/** Merge both logs into one stream with Δ, status changes, mentions and search text. Newest first. */
export function buildFeed(agi: Pick<AgiData, 'log'>, asi: Pick<AsiData, 'log' | 'events' | 'items'>): FeedEntry[] {
  const items = new Map<number, AsiItem>((asi.items ?? []).map((i) => [i.id, i]));
  const out: Omit<FeedEntry, 'order'>[] = [];

  let prev: number | null = null;
  for (const { item: l, idx } of chrono(agi.log ?? [])) {
    const isPct = l.kind === 'pct' && typeof l.value === 'number';
    const { title, summary } = splitTitle(l.title, l.summary);
    const links = linksOf(l.links);
    let prevPct: number | null = null;
    let delta: number | null = null;
    if (isPct) {
      prevPct = prev;
      delta = prev === null ? null : l.value! - prev;
      prev = l.value!;
    }
    const labs = detectLabs(`${title} ${summary}`);
    out.push({
      id: `agi-${idx}`,
      source: 'agi',
      type: isPct ? 'agi-pct' : 'agi-info',
      date: l.date,
      month: l.date.slice(0, 7),
      title,
      summary,
      links,
      hosts: [...new Set(links.map((x) => x.host).filter(Boolean))],
      labs,
      pct: isPct ? l.value! : null,
      prevPct,
      delta,
      indicators: [],
      asiChange: null,
      moved: isPct && delta !== null && delta > 0,
      search: '',
    });
  }

  const changes = asiChanges(asi.log ?? [], asi.events);
  for (const { item: l, idx } of chrono(asi.log ?? [])) {
    const { title, summary } = splitTitle(l.title, l.summary);
    const links = linksOf(l.links);
    const per = changes.get(idx);
    const indicators: IndicatorRef[] = (l.ids ?? [])
      .filter((r) => r.status === 'achieved' || r.status === 'partial')
      .map((r) => {
        const it = items.get(r.id);
        return {
          id: r.id,
          status: r.status as IndicatorRef['status'],
          change: per?.get(r.id) ?? null,
          label: it?.label ?? `Indicator #${r.id}`,
          keyword: it?.keyword || it?.label || `#${r.id}`,
          phase: it?.phase ?? null,
          type: it?.type ?? null,
        };
      });
    const asiChange = indicators.length ? (indicators.some((i) => i.change) ? 'status' : 'evidence') : null;
    out.push({
      id: `asi-${idx}`,
      source: 'asi',
      type: 'asi',
      date: l.date,
      month: l.date.slice(0, 7),
      title,
      summary,
      links,
      hosts: [...new Set(links.map((x) => x.host).filter(Boolean))],
      labs: detectLabs(`${title} ${summary}`),
      pct: null,
      prevPct: null,
      delta: null,
      indicators,
      asiChange,
      moved: asiChange === 'status',
      search: '',
    });
  }

  // Stable merged chronology: by date, then AGI before ASI within a month, then per-log order.
  const srcRank = (e: { source: Source }) => (e.source === 'agi' ? 0 : 1);
  const seq = new Map(out.map((e, i) => [e.id, i]));
  out.sort((a, b) => a.date.localeCompare(b.date) || srcRank(a) - srcRank(b) || seq.get(a.id)! - seq.get(b.id)!);
  return out
    .map((e, order) => {
      const full = { ...e, order } as FeedEntry;
      full.search = [
        e.title,
        e.summary,
        TYPE_LABEL[e.type],
        e.pct !== null ? `${e.pct}%` : '',
        ...e.links.map((l) => `${l.label} ${l.host}`),
        ...e.labs.map((k) => LAB_BY_KEY.get(k)?.label ?? k),
        ...e.indicators.map((i) => `#${i.id} ${i.label} ${i.keyword} ${i.type ?? ''}`),
      ]
        .join(' ')
        .toLowerCase();
      return full;
    })
    .reverse();
}

/* ───────────────────────────── Filtering ───────────────────────────── */

export interface FeedFilters {
  q: string;
  date: DateFilterValue;
  sources: string[];
  types: string[];
  moved: boolean;
  pct: RangeValue;
  indicators: string[];
  phases: string[];
  statuses: string[];
  itypes: string[];
  labs: string[];
  hosts: string[];
  hasLinks: boolean;
}

export const EMPTY_FEED_FILTERS: FeedFilters = {
  q: '',
  date: { mode: 'any' },
  sources: [],
  types: [],
  moved: false,
  pct: {},
  indicators: [],
  phases: [],
  statuses: [],
  itypes: [],
  labs: [],
  hosts: [],
  hasLinks: false,
};

export type FeedFilterKey = keyof FeedFilters;
const INDICATOR_KEYS = ['indicators', 'phases', 'statuses', 'itypes'] as const;
type IndicatorKey = (typeof INDICATOR_KEYS)[number];

function indicatorValue(i: IndicatorRef, key: IndicatorKey): string {
  if (key === 'indicators') return String(i.id);
  if (key === 'phases') return i.phase === null ? '' : String(i.phase);
  if (key === 'statuses') return i.status;
  return i.type ?? '';
}

/** Indicators of an entry that satisfy every active indicator-level filter (optionally ignoring one). */
function matchingIndicators(e: FeedEntry, f: FeedFilters, skip?: FeedFilterKey): IndicatorRef[] {
  return e.indicators.filter((i) => INDICATOR_KEYS.every((k) => k === skip || matchAny(indicatorValue(i, k), f[k])));
}

const indicatorFiltersActive = (f: FeedFilters, skip?: FeedFilterKey) => INDICATOR_KEYS.some((k) => k !== skip && f[k].length > 0);

/**
 * Does an entry pass the filters? `skip` ignores one filter (used for facet counts).
 * Filters on a source-specific attribute (AGI %, ASI indicator…) exclude entries without it.
 * The indicator-level filters (id, phase, status, type) must hold for the SAME indicator.
 */
export function matchEntry(e: FeedEntry, f: FeedFilters, skip?: FeedFilterKey): boolean {
  if (skip !== 'date' && !matchDate(e.date, f.date)) return false;
  if (skip !== 'sources' && !matchAny(e.source, f.sources)) return false;
  if (skip !== 'types' && !matchAny(e.type, f.types)) return false;
  if (skip !== 'moved' && f.moved && !e.moved) return false;
  if (skip !== 'pct' && isRangeActive(f.pct) && !inRange(e.pct, f.pct)) return false;
  if (indicatorFiltersActive(f, skip) && matchingIndicators(e, f, skip).length === 0) return false;
  if (skip !== 'labs' && !matchAny(e.labs, f.labs)) return false;
  if (skip !== 'hosts' && !matchAny(e.hosts, f.hosts)) return false;
  if (skip !== 'hasLinks' && f.hasLinks && e.links.length === 0) return false;
  if (skip !== 'q' && !textMatch(e.search, f.q)) return false;
  return true;
}

export const filterFeed = (entries: FeedEntry[], f: FeedFilters, skip?: FeedFilterKey) => entries.filter((e) => matchEntry(e, f, skip));

export type FeedFacetKey = 'sources' | 'types' | 'indicators' | 'phases' | 'statuses' | 'itypes' | 'labs' | 'hosts';

/** Facet counts: for each facet, how many entries carry each value given every OTHER active filter. */
export function feedFacets(entries: FeedEntry[], f: FeedFilters): Record<FeedFacetKey, Map<string, number>> & { moved: number; hasLinks: number } {
  const count = (key: FeedFacetKey) => {
    const pool = filterFeed(entries, f, key);
    if ((INDICATOR_KEYS as readonly string[]).includes(key)) {
      return countBy(pool, (e) => [...new Set(matchingIndicators(e, f, key).map((i) => indicatorValue(i, key as IndicatorKey)).filter(Boolean))]);
    }
    return countBy(pool, (e) => (key === 'sources' ? e.source : key === 'types' ? e.type : key === 'labs' ? e.labs : e.hosts));
  };
  return {
    sources: count('sources'),
    types: count('types'),
    indicators: count('indicators'),
    phases: count('phases'),
    statuses: count('statuses'),
    itypes: count('itypes'),
    labs: count('labs'),
    hosts: count('hosts'),
    moved: filterFeed(entries, f, 'moved').filter((e) => e.moved).length,
    hasLinks: filterFeed(entries, f, 'hasLinks').filter((e) => e.links.length > 0).length,
  };
}

/** Number of active filters (for the mobile "Filters (n)" button). Search is not counted. */
export function activeFeedFilterCount(f: FeedFilters): number {
  let n = 0;
  if (f.date.mode !== 'any' && (f.date.from || f.date.to)) n++;
  if (f.moved) n++;
  if (f.hasLinks) n++;
  if (isRangeActive(f.pct)) n++;
  for (const k of ['sources', 'types', 'indicators', 'phases', 'statuses', 'itypes', 'labs', 'hosts'] as const) if (f[k].length) n++;
  return n;
}

/* ───────────────────────────── Sorting + grouping ───────────────────────────── */

export type FeedSort = 'newest' | 'oldest' | 'delta';

export function sortFeed(entries: FeedEntry[], sort: FeedSort): FeedEntry[] {
  const list = [...entries];
  if (sort === 'oldest') return list.sort((a, b) => a.order - b.order);
  if (sort === 'newest') return list.sort((a, b) => b.order - a.order);
  // Largest Δ: AGI rises by points, then ASI status changes by how many indicators changed,
  // then everything else (a fall, if Alan ever lowers the gauge, sinks to the bottom); ties newest first.
  const key = (e: FeedEntry) => {
    if (e.delta !== null && e.delta !== 0) return e.delta > 0 ? 1000 + e.delta : e.delta;
    const changed = e.indicators.filter((i) => i.change).length;
    return changed ? 100 + changed : 0;
  };
  return list.sort((a, b) => key(b) - key(a) || b.order - a.order);
}

export interface MonthGroup<T> {
  month: string;
  entries: T[];
}

/** Consecutive runs of the same month, in the given order. */
export function groupByMonth<T extends { month: string }>(entries: T[]): MonthGroup<T>[] {
  const out: MonthGroup<T>[] = [];
  for (const e of entries) {
    const last = out.at(-1);
    if (last && last.month === e.month) last.entries.push(e);
    else out.push({ month: e.month, entries: [e] });
  }
  return out;
}

/* ───────────────────────────── Months + histogram ───────────────────────────── */

export const monthStart = (key: string) => `${key.slice(0, 7)}-01`;
export function monthEnd(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${key.slice(0, 7)}-${String(d).padStart(2, '0')}`;
}
export function addMonthKey(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return yb * 12 + mb - (ya * 12 + ma);
}

export interface HistBin {
  key: string;
  from: string | null;
  to: string;
  count: number;
}

/** The histogram's month axis: at most `maxMonths` bars ending at the newest month; older entries fold into one "earlier" bin. */
export function histogramAxis(dates: string[], maxMonths = 60): { start: string; end: string; hasEarlier: boolean } | null {
  const months = dates.filter((d) => /^\d{4}-\d{2}/.test(d)).map((d) => d.slice(0, 7)).sort();
  if (!months.length) return null;
  const end = months.at(-1)!;
  const first = months[0];
  const start = monthsBetween(first, end) + 1 > maxMonths ? addMonthKey(end, -(maxMonths - 1)) : first;
  return { start, end, hasEarlier: first < start };
}

/** Counts per month bar (plus the "earlier" bin) for the given entries on a fixed axis. */
export function monthHistogram(entries: { date: string }[], axis: { start: string; end: string; hasEarlier: boolean }): { earlier: HistBin | null; bins: HistBin[] } {
  const n = monthsBetween(axis.start, axis.end) + 1;
  const bins: HistBin[] = Array.from({ length: n }, (_, i) => {
    const key = addMonthKey(axis.start, i);
    return { key, from: monthStart(key), to: monthEnd(key), count: 0 };
  });
  const earlier: HistBin | null = axis.hasEarlier ? { key: 'earlier', from: null, to: monthEnd(addMonthKey(axis.start, -1)), count: 0 } : null;
  for (const e of entries) {
    const k = e.date.slice(0, 7);
    if (k < axis.start) {
      if (earlier) earlier.count++;
      continue;
    }
    const i = monthsBetween(axis.start, k);
    if (i >= 0 && i < n) bins[i].count++;
  }
  return { earlier, bins };
}

/** Does a histogram bin overlap the active date filter? */
export function binInDate(bin: Pick<HistBin, 'from' | 'to'>, f: DateFilterValue): boolean {
  if (f.mode === 'any' || (!f.from && !f.to)) return false;
  const lo = bin.from ?? '0000-01-01';
  const hi = bin.to;
  const from = f.mode === 'before' ? undefined : f.from;
  const to = f.mode === 'after' ? undefined : f.to;
  return (!from || hi >= from) && (!to || lo <= to);
}

/**
 * Histogram click → date filter. A plain click selects that month (clicking the only
 * selected month again clears it). Shift-click extends the current range to include the bin.
 */
export function pickBin(cur: DateFilterValue, bin: Pick<HistBin, 'from' | 'to'>, extend: boolean): DateFilterValue {
  const active = cur.mode !== 'any' && !!(cur.from || cur.to);
  if (extend && active) {
    const curFrom = cur.mode === 'before' ? null : cur.from ?? null;
    const curTo = cur.mode === 'after' ? null : cur.to ?? null;
    // An open end stays open; otherwise stretch it to cover the bin.
    const from = cur.mode === 'before' || bin.from === null ? null : curFrom === null ? null : bin.from < curFrom ? bin.from : curFrom;
    const to = cur.mode === 'after' ? null : curTo === null ? null : bin.to > curTo ? bin.to : curTo;
    if (from === null && to === null) return { mode: 'any' };
    if (from === null) return { mode: 'before', to: to! };
    if (to === null) return { mode: 'after', from };
    return { mode: 'between', from, to };
  }
  if (bin.from === null) {
    if (cur.mode === 'before' && cur.to === bin.to) return { mode: 'any' };
    return { mode: 'before', to: bin.to };
  }
  if (cur.mode === 'between' && cur.from === bin.from && cur.to === bin.to) return { mode: 'any' };
  return { mode: 'between', from: bin.from, to: bin.to };
}

/* ───────────────────────────── Stats ───────────────────────────── */

export function feedStats(entries: FeedEntry[]) {
  const dates = entries.map((e) => e.date).sort();
  return {
    total: entries.length,
    agiMoves: entries.filter((e) => e.type === 'agi-pct' && e.moved).length,
    asiStatusChanges: entries.filter((e) => e.asiChange === 'status').length,
    indicatorChanges: entries.reduce((n, e) => n + e.indicators.filter((i) => i.change).length, 0),
    first: dates[0] ?? null,
    last: dates.at(-1) ?? null,
  };
}
