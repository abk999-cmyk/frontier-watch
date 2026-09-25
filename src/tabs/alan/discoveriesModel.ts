// Pure data shaping for the "AI discoveries" view (no React).
// Merges the curated breakthroughs list (charts.json → breakthroughs, from
// data/curated/breakthroughs.yaml) with Alan's running discoveries table
// (alan.json → asi.discoveries). Every optional field is guarded: the curated file
// is growing and may or may not carry model / modelId / tags / problem / alanRef.

import type { AsiData } from '../../../shared/types.ts';
import { addMonths, inRange, isRangeActive, matchAny, matchDate, textMatch, todayIso, type DateFilterValue, type RangeValue } from '../../lib/filters.ts';
import { detectLabs, LAB_BY_KEY } from './feedModel.ts';

export type Domain = 'math' | 'science';
export type Verification = 'formal-proof' | 'peer-reviewed' | 'expert-endorsed' | 'claimed' | 'disputed';
export type Autonomy = 'tool' | 'collaborative' | 'autonomous';
export type DiscSource = 'curated' | 'alan' | 'both';
export type AlanDiscovery = AsiData['discoveries'][number];

export const VERIFICATIONS: Verification[] = ['formal-proof', 'peer-reviewed', 'expert-endorsed', 'claimed', 'disputed'];
export const AUTONOMIES: Autonomy[] = ['tool', 'collaborative', 'autonomous'];
export const TIER_NAMES = ['Rediscovery', 'Interesting', 'Solid', 'Major', 'Breakthrough', 'Millennium/Nobel'];
export const tierName = (s: number) => TIER_NAMES[Math.max(0, Math.min(5, Math.round(s)))];
/** "Verified" in the headline count: checked in Lean or refereed (same rule as the Charts tab). */
export const VERIFIED: Verification[] = ['formal-proof', 'peer-reviewed'];
/** Sentinel facet value for a missing domain / verification / autonomy (Alan-only rows). */
export const UNKNOWN = 'unknown';

export interface Discovery {
  id: string;
  /** ISO YYYY-MM-DD, or null when the source date can't be parsed. */
  date: string | null;
  precision: 'day' | 'month' | 'year';
  title: string;
  domain: Domain | null;
  field: string | null;
  system: string | null;
  model: string | null;
  modelId: string | null;
  org: string | null;
  /** Canonical org names for the facet ("Google DeepMind / Isomorphic Labs" → both). */
  orgs: string[];
  /** Labs detected in org + system + model (LAB_DEFS keys). */
  labs: string[];
  /** 0–5, or null when unknown (Alan-only rows). */
  significance: number | null;
  verification: Verification | null;
  autonomy: Autonomy | null;
  tags: string[];
  problem: string | null;
  summary: string | null;
  url: string | null;
  /** Rows of Alan's table merged into this entry (via the curated `alanRef`, or the row itself). */
  alan: AlanDiscovery[];
  source: DiscSource;
  /** Model/system facet values. */
  models: string[];
  search: string;
}

/* ───────────────────────────── guards ───────────────────────────── */

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v).trim() || null);
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
/** js-yaml turns bare dates into Date objects, which JSON-serialise as full ISO strings. */
export function isoDay(v: unknown): { date: string; precision: Discovery['precision'] } | null {
  const s = str(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return { date: s.slice(0, 10), precision: 'day' };
  if (/^\d{4}-\d{2}$/.test(s)) return { date: `${s}-01`, precision: 'month' };
  if (/^\d{4}$/.test(s)) return { date: `${s}-01-01`, precision: 'year' };
  return null;
}
const oneOf = <T extends string>(v: unknown, all: readonly T[]): T | null => (typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : null);
const refs = (v: unknown): number[] => (Array.isArray(v) ? v : v == null ? [] : [v]).map(num).filter((n): n is number => n !== null);

/* ───────────────────────────── orgs ───────────────────────────── */

const ORG_ALIAS: [RegExp, string][] = [
  [/^(?:google\s+)?deepmind$|^gdm$/i, 'Google DeepMind'],
  [/^meta(?: fair| ai)?$|^fair$/i, 'Meta'],
];

/**
 * Canonical org names for the facet. Drops parentheticals ("Anthropic (elicited by …)"),
 * keeps the lead org of "X with Y", splits "A / B", and merges DeepMind spellings.
 */
export function orgParts(org: string | null | undefined): string[] {
  if (!org) return [];
  const base = org
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+with\s+/i)[0]
    .trim();
  const parts = base
    .split(/\s*\/\s*/)
    .map((p) => p.replace(/\s+/g, ' ').replace(/[,;]\s*$/, '').trim())
    .filter(Boolean)
    .map((p) => ORG_ALIAS.find(([re]) => re.test(p))?.[1] ?? p);
  return [...new Set(parts)];
}

/* ───────────────────────────── merge ───────────────────────────── */

/** Curated breakthroughs + Alan's list → one list, newest first. */
export function buildDiscoveries(rawBreakthroughs: unknown, alanRows: AlanDiscovery[] | null | undefined): Discovery[] {
  const alanList = Array.isArray(alanRows) ? alanRows.filter((r) => r && r.n != null) : [];
  const alanByN = new Map(alanList.map((r) => [Number(r.n), r]));
  const referenced = new Set<number>();
  const out: Discovery[] = [];

  for (const b of Array.isArray(rawBreakthroughs) ? (rawBreakthroughs as any[]) : []) {
    const title = str(b?.title);
    if (!b || !title) continue;
    const d = isoDay(b.date);
    const alan = refs(b.alanRef)
      .map((n) => {
        const row = alanByN.get(n);
        if (row) referenced.add(n);
        return row;
      })
      .filter((r): r is AlanDiscovery => !!r);
    const sig = num(b.significance);
    const org = str(b.org);
    const system = str(b.system);
    const model = str(b.model);
    const precision = oneOf(b.datePrecision, ['day', 'month', 'year'] as const) ?? d?.precision ?? 'day';
    out.push(
      finish({
        id: str(b.id) ?? `curated-${out.length}`,
        date: d?.date ?? null,
        precision,
        title,
        domain: oneOf(b.domain, ['math', 'science'] as const),
        field: str(b.field),
        system,
        model,
        modelId: str(b.modelId),
        org,
        orgs: orgParts(org),
        labs: [],
        significance: sig === null ? null : Math.max(0, Math.min(5, sig)),
        verification: oneOf(b.verification, VERIFICATIONS),
        autonomy: oneOf(b.autonomy, AUTONOMIES),
        tags: Array.isArray(b.tags) ? [...new Set((b.tags as unknown[]).map(str).filter((t): t is string => !!t))] : [],
        problem: str(b.problem),
        summary: str(b.summary),
        url: str(b.url),
        alan,
        source: alan.length ? 'both' : 'curated',
        models: [],
        search: '',
      }),
    );
  }

  for (const r of alanList) {
    if (referenced.has(Number(r.n))) continue;
    const d = isoDay(r.date);
    const org = str(r.org);
    out.push(
      finish({
        id: `alan-${r.n}`,
        date: d?.date ?? null,
        precision: d?.precision === 'day' ? 'month' : (d?.precision ?? 'month'), // Alan's table is month-precision
        title: str(r.discovery) ?? `Discovery #${r.n}`,
        domain: null,
        field: null,
        system: null,
        model: str(r.model),
        modelId: null,
        org,
        orgs: orgParts(org),
        labs: [],
        significance: null,
        verification: null,
        autonomy: null,
        tags: [],
        problem: null,
        summary: null,
        url: str(r.url),
        alan: [r],
        source: 'alan',
        models: [],
        search: '',
      }),
    );
  }

  return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title));
}

function finish(d: Discovery): Discovery {
  const alanModels = d.alan.map((r) => str(r.model)).filter((m): m is string => !!m);
  const alanOrgs = d.alan.map((r) => str(r.org)).filter((o): o is string => !!o);
  d.models = [...new Set([d.model, d.system, ...alanModels].filter((m): m is string => !!m))];
  d.labs = detectLabs([d.org, d.system, d.model, ...alanModels, ...alanOrgs].filter(Boolean).join(' · '));
  d.search = [
    d.title,
    d.summary,
    d.field,
    d.domain,
    d.org,
    d.system,
    d.model,
    d.problem,
    ...d.tags,
    ...d.labs.map((k) => LAB_BY_KEY.get(k)?.label ?? k),
    ...d.alan.flatMap((r) => [r.discovery, r.model, r.org, `#${r.n}`]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return d;
}

/* ───────────────────────────── filters ───────────────────────────── */

export type SourceFilter = 'any' | 'curated' | 'alan' | 'both';

export interface DiscFilters {
  q: string;
  date: DateFilterValue;
  domains: string[];
  fields: string[];
  sig: RangeValue;
  verifs: string[];
  autonomies: string[];
  orgs: string[];
  labs: string[];
  models: string[];
  tags: string[];
  problems: string[];
  hasProblem: boolean;
  source: SourceFilter;
}

export const EMPTY_DISC_FILTERS: DiscFilters = {
  q: '',
  date: { mode: 'any' },
  domains: [],
  fields: [],
  sig: {},
  verifs: [],
  autonomies: [],
  orgs: [],
  labs: [],
  models: [],
  tags: [],
  problems: [],
  hasProblem: false,
  source: 'any',
};

export type DiscFilterKey = keyof DiscFilters;
export type DiscFacetKey = 'domains' | 'fields' | 'verifs' | 'autonomies' | 'orgs' | 'labs' | 'models' | 'tags' | 'problems';

/** The values an entry carries for a facet (null fields → UNKNOWN where that's a meaningful bucket). */
export function facetValues(d: Discovery, key: DiscFacetKey): string[] {
  switch (key) {
    case 'domains':
      return [d.domain ?? UNKNOWN];
    case 'fields':
      return d.field ? [d.field] : [];
    case 'verifs':
      return [d.verification ?? UNKNOWN];
    case 'autonomies':
      return [d.autonomy ?? UNKNOWN];
    case 'orgs':
      return d.orgs;
    case 'labs':
      return d.labs.length ? d.labs : ['none'];
    case 'models':
      return d.models;
    case 'tags':
      return d.tags;
    case 'problems':
      return d.problem ? [d.problem] : [];
  }
}

export function matchSource(d: Discovery, s: SourceFilter): boolean {
  if (s === 'any') return true;
  if (s === 'both') return d.source === 'both';
  return d.source === s || d.source === 'both';
}

const FACETS: DiscFacetKey[] = ['domains', 'fields', 'verifs', 'autonomies', 'orgs', 'labs', 'models', 'tags', 'problems'];

/** Significance filters exclude unrated (Alan-only) rows: an unknown grade is never "in range". */
export function matchDiscovery(d: Discovery, f: DiscFilters, skip?: DiscFilterKey): boolean {
  if (skip !== 'date' && !matchDate(d.date, f.date)) return false;
  if (skip !== 'sig' && isRangeActive(f.sig) && !inRange(d.significance, f.sig)) return false;
  if (skip !== 'hasProblem' && f.hasProblem && !d.problem) return false;
  if (skip !== 'source' && !matchSource(d, f.source)) return false;
  for (const k of FACETS) if (k !== skip && !matchAny(facetValues(d, k), f[k])) return false;
  if (skip !== 'q' && !textMatch(d.search, f.q)) return false;
  return true;
}

export const filterDiscoveries = (list: Discovery[], f: DiscFilters, skip?: DiscFilterKey) => list.filter((d) => matchDiscovery(d, f, skip));

export function discFacets(list: Discovery[], f: DiscFilters): Record<DiscFacetKey, Map<string, number>> & { sources: Record<SourceFilter, number>; hasProblem: number } {
  const out = {} as Record<DiscFacetKey, Map<string, number>>;
  for (const k of FACETS) {
    const m = new Map<string, number>();
    for (const d of filterDiscoveries(list, f, k)) for (const v of new Set(facetValues(d, k))) m.set(v, (m.get(v) ?? 0) + 1);
    out[k] = m;
  }
  const srcPool = filterDiscoveries(list, f, 'source');
  const sources = { any: srcPool.length, curated: 0, alan: 0, both: 0 } as Record<SourceFilter, number>;
  for (const d of srcPool) for (const s of ['curated', 'alan', 'both'] as const) if (matchSource(d, s)) sources[s]++;
  return { ...out, sources, hasProblem: filterDiscoveries(list, f, 'hasProblem').filter((d) => d.problem).length };
}

export function activeDiscFilterCount(f: DiscFilters): number {
  let n = 0;
  if (f.date.mode !== 'any' && (f.date.from || f.date.to)) n++;
  if (isRangeActive(f.sig)) n++;
  if (f.hasProblem) n++;
  if (f.source !== 'any') n++;
  for (const k of FACETS) if (f[k].length) n++;
  return n;
}

/* ───────────────────────────── sorting ───────────────────────────── */

export type DiscSortKey = 'date' | 'title' | 'significance' | 'verification' | 'autonomy' | 'domain' | 'org' | 'model' | 'source';
export type SortDir = 'asc' | 'desc';

const VERIF_RANK: Record<Verification, number> = { 'formal-proof': 4, 'peer-reviewed': 3, 'expert-endorsed': 2, claimed: 1, disputed: 0 };
const AUTONOMY_RANK: Record<Autonomy, number> = { tool: 0, collaborative: 1, autonomous: 2 };
const SOURCE_RANK: Record<DiscSource, number> = { curated: 0, both: 1, alan: 2 };

function sortValue(d: Discovery, key: DiscSortKey): string | number | null {
  switch (key) {
    case 'date':
      return d.date;
    case 'title':
      return d.title.toLowerCase();
    case 'significance':
      return d.significance;
    case 'verification':
      return d.verification ? VERIF_RANK[d.verification] : null;
    case 'autonomy':
      return d.autonomy ? AUTONOMY_RANK[d.autonomy] : null;
    case 'domain':
      return d.domain ? `${d.domain} ${d.field ?? ''}`.toLowerCase() : null;
    case 'org':
      return (d.orgs[0] ?? d.org)?.toLowerCase() ?? null;
    case 'model':
      return d.models[0]?.toLowerCase() ?? null;
    case 'source':
      return SOURCE_RANK[d.source];
  }
}

/** Stable sort by one column. Missing values always sink to the bottom; ties go newest first. */
export function sortDiscoveries(list: Discovery[], key: DiscSortKey, dir: SortDir): Discovery[] {
  const sgn = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) return (va < vb ? -1 : 1) * sgn;
    return (b.date ?? '').localeCompare(a.date ?? '');
  });
}

/* ───────────────────────────── stats ───────────────────────────── */

export function discStats(list: Discovery[], today = todayIso()) {
  const since = addMonths(today, -12);
  return {
    total: list.length,
    last12: list.filter((d) => d.date && d.date >= since && d.date <= today).length,
    verified: list.filter((d) => d.verification && VERIFIED.includes(d.verification)).length,
    inAlan: list.filter((d) => d.source !== 'curated').length,
  };
}

/** FNV-1a → [0, 1). Deterministic per id, so timeline jitter never moves between renders. */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
}

/** "Sep 23, 2026" / "Sep 2026" / "2026", honest to the source's precision. */
export function fmtDiscDate(d: Pick<Discovery, 'date' | 'precision'>): string {
  if (!d.date) return 'Undated';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, day] = d.date.split('-').map(Number);
  if (d.precision === 'year') return String(y);
  if (d.precision === 'month') return `${MON[m - 1]} ${y}`;
  return `${MON[m - 1]} ${day}, ${y}`;
}
