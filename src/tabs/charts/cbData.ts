// Pure data shaping for the Spending, LEV and Breakthroughs panels (no React).
// Everything here reads charts.json exactly as scripts/build-data.ts writes it and
// guards every optional field; nothing here invents a value.

import { toTime, yearFrac } from '../../lib/format.ts';

// ── generic guards ──────────────────────────────────────────────────────────
export const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
export const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
/** js-yaml turns bare dates into Date objects, which JSON-serialise as full ISO strings. */
export const isoDay = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  return null;
};
export const arr = <T = any>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** FNV-1a → [0, 1). Deterministic per id, so jitter never moves between renders. */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
}

// ── quarters ────────────────────────────────────────────────────────────────
/** Quarter index: year*4 + (q-1). */
export const qIndex = (q: string): number => {
  const m = /^(\d{4})-Q([1-4])$/.exec(q);
  return m ? Number(m[1]) * 4 + Number(m[2]) - 1 : NaN;
};
export const qYear = (i: number) => Math.floor(i / 4);
export const qKey = (i: number) => `${qYear(i)}-Q${(i % 4) + 1}`;
export const qLabel = (i: number) => `Q${(i % 4) + 1} '${String(qYear(i)).slice(2)}`;
export const qStart = (i: number) => Date.UTC(qYear(i), (i % 4) * 3, 1);
export const qOfDate = (d: string) => {
  const [y, m] = d.split('-').map(Number);
  return y * 4 + Math.floor((m - 1) / 3);
};

// ── capex ───────────────────────────────────────────────────────────────────
export const CAPEX_COMPANIES = ['Microsoft', 'Alphabet', 'Amazon', 'Meta', 'Oracle'] as const;
const COMPANY_ALIAS: Record<string, string> = {
  microsoft: 'Microsoft',
  msft: 'Microsoft',
  alphabet: 'Alphabet',
  google: 'Alphabet',
  googl: 'Alphabet',
  amazon: 'Amazon',
  amzn: 'Amazon',
  aws: 'Amazon',
  meta: 'Meta',
  'meta platforms': 'Meta',
  facebook: 'Meta',
  oracle: 'Oracle',
  orcl: 'Oracle',
};
export const canonCompany = (c: string) => COMPANY_ALIAS[c.trim().toLowerCase()] ?? c.trim();

export interface CapexRow {
  company: string;
  quarter: string;
  capex: number;
  financeLeases?: number | null;
  /** company's own headline capex where it differs (only if the pipeline passes it through) */
  headline?: number | null;
  period?: string | null;
  note?: string | null;
  url?: string | null;
}

export interface Guidance {
  company: string;
  period: string;
  /** Calendar quarters (indices) the guided period covers, in order; null when it can't be mapped. */
  quarters: number[] | null;
  low: number | null;
  high: number | null;
  mid: number | null;
  basis: string | null;
  /** guidance is on a basis that includes finance leases (Microsoft/Meta headline capex) */
  includesLeases: boolean;
  issued: string | null;
  note: string | null;
  url: string | null;
}

export interface CapexModel {
  companies: string[];
  rows: CapexRow[];
  unitNote: string;
  actual: Map<string, Map<number, CapexRow>>;
  guidance: Guidance[];
  lastReported: Map<string, number>;
  first: number;
  last: number;
  definition: string | null;
  fiscalMapping: string | null;
  financeLeasesBasis: Record<string, string>;
}

/** Scale to $B. Honour an explicit unit; else treat values > 1000 as $M (no hyperscaler spends $1T a quarter). */
function unitScale(raw: any, rows: { capex: number }[]): { k: number; note: string } {
  const u = String(raw?.unit ?? raw?.units ?? '').toLowerCase();
  if (/million|\bm\b|musd|usd_m/.test(u)) return { k: 1e-3, note: 'source in $M' };
  if (/billion|\bb\b|busd|usd_b/.test(u)) return { k: 1, note: 'source in $B' };
  const vals = rows.map((r) => r.capex).sort((a, b) => a - b);
  const med = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
  return med > 1000 ? { k: 1e-3, note: 'source in $M' } : { k: 1, note: 'source in $B' };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Map a guided period to calendar quarters. "CY2026"/2026 → 2026-Q1..Q4. A fiscal year
 * with an explicit month span, e.g. "FY2027 (Jun 2026-May 2027)", maps each fiscal quarter
 * to the calendar quarter holding its middle month (the rule capex.yaml's fiscalMapping uses).
 */
function guidanceQuarters(period: string, year: number | null): number[] | null {
  const span = /\(\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{4})\s*[-–]\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{4})\s*\)/.exec(period);
  if (span) {
    const m0 = MONTHS.indexOf(span[1].toLowerCase());
    if (m0 < 0) return null;
    const start = Number(span[2]) * 12 + m0; // month index
    return [0, 1, 2, 3].map((k) => {
      const mid = start + k * 3 + 1;
      return Math.floor(mid / 12) * 4 + Math.floor((mid % 12) / 3);
    });
  }
  if (/fy|fiscal/i.test(period)) return null;
  const ym = /(20\d{2})/.exec(period);
  const y = ym ? Number(ym[1]) : year;
  return y ? [0, 1, 2, 3].map((q) => y * 4 + q) : null;
}

function parseGuidance(g: any, k: number): Guidance | null {
  const company = str(g?.company);
  if (!company) return null;
  const period = str(g.period) ?? (g.year != null ? `CY${g.year}` : '');
  const range = Array.isArray(g.range) ? g.range : null;
  const scale = (v: number | null) => (v == null ? null : v * k);
  const low = scale(num(g.low ?? g.min ?? g.rangeLow ?? range?.[0]));
  const high = scale(num(g.high ?? g.max ?? g.rangeHigh ?? range?.[1]));
  const point = scale(num(g.value ?? g.capex ?? g.mid ?? g.midpoint ?? g.usdBillions ?? g.amount));
  const mid = point ?? (low != null && high != null ? (low + high) / 2 : (low ?? high));
  const basis = str(g.basis);
  return {
    company: canonCompany(company),
    period,
    quarters: guidanceQuarters(period, num(g.year)),
    low,
    high,
    mid,
    basis,
    includesLeases: /finance lease|headline/i.test(basis ?? ''),
    issued: isoDay(g.stated ?? g.date ?? g.asOf ?? g.issued ?? g.published),
    note: str(g.note ?? g.summary),
    url: str(g.url ?? g.source),
  };
}

export function buildCapexModel(capexRaw: any): CapexModel | null {
  const src = arr<any>(capexRaw?.quarters).filter((r) => r && typeof r.company === 'string' && Number.isFinite(qIndex(r.quarter)) && num(r.capex) != null);
  if (!src.length) return null;
  const { k, note: unitNote } = unitScale(capexRaw, src.map((r) => ({ capex: num(r.capex)! })));
  const sc = (v: unknown) => (num(v) != null ? num(v)! * k : null);
  const rows: CapexRow[] = src.map((r) => ({
    company: canonCompany(r.company),
    quarter: r.quarter,
    capex: num(r.capex)! * k,
    financeLeases: sc(r.financeLeases),
    headline: sc(r.headline),
    period: str(r.period),
    note: str(r.note),
    url: str(r.url),
  }));
  const actual = new Map<string, Map<number, CapexRow>>();
  for (const r of rows) {
    const m = actual.get(r.company) ?? new Map<number, CapexRow>();
    m.set(qIndex(r.quarter), r);
    actual.set(r.company, m);
  }
  const known = CAPEX_COMPANIES.filter((c) => actual.has(c)) as string[];
  const extra = [...actual.keys()].filter((c) => !known.includes(c)).sort();
  const lastReported = new Map<string, number>();
  let first = Infinity;
  let last = -Infinity;
  for (const [c, m] of actual) {
    const ks = [...m.keys()];
    lastReported.set(c, Math.max(...ks));
    first = Math.min(first, ...ks);
    last = Math.max(last, ...ks);
  }
  const guidance = arr<any>(capexRaw?.guidance)
    .map((g) => parseGuidance(g, k))
    .filter((g): g is Guidance => !!g);
  const flb = capexRaw?.financeLeasesBasis;
  const financeLeasesBasis: Record<string, string> = {};
  if (flb && typeof flb === 'object') for (const [c, v] of Object.entries(flb)) if (typeof v === 'string') financeLeasesBasis[canonCompany(c)] = v;
  return {
    companies: [...known, ...extra],
    rows,
    unitNote,
    actual,
    guidance,
    lastReported,
    first,
    last,
    definition: str(capexRaw?.definition),
    fiscalMapping: typeof capexRaw?.fiscalMapping === 'string' ? capexRaw.fiscalMapping : null,
    financeLeasesBasis,
  };
}

export const capexValue = (r: CapexRow, leases: boolean) => r.capex + (leases ? (r.financeLeases ?? 0) : 0);
/** A reported quarter on the guidance's own basis: headline if known, else capex (+ finance leases when the guide includes them). */
const onGuidanceBasis = (r: CapexRow, g: Guidance) => (g.includesLeases ? (r.headline ?? r.capex + (r.financeLeases ?? 0)) : r.capex);

export interface ImpliedCell {
  v: number;
  guidance: Guidance;
  reportedYtd: number;
  remaining: number;
  open: number;
  /** reported quarters were approximated as capex + finance leases (no headline figure in the data) */
  approx: boolean;
}

/**
 * Quarters of a guided period that aren't reported yet get the remainder of the guided
 * midpoint spread evenly: (guided − reported so far, on the guidance's basis) ÷ quarters left.
 * Arithmetic on sourced numbers only — always drawn as a ghost and labelled "implied by guidance".
 */
export function impliedFromGuidance(m: CapexModel): Map<string, Map<number, ImpliedCell>> {
  const out = new Map<string, Map<number, ImpliedCell>>();
  // One guidance per company-period: the most recently stated (file order breaks ties).
  const latest = new Map<string, Guidance>();
  for (const g of m.guidance) {
    if (!g.quarters || g.mid == null) continue;
    const key = `${g.company}|${g.quarters[0]}`;
    const prev = latest.get(key);
    if (!prev || (g.issued ?? '') >= (prev.issued ?? '')) latest.set(key, g);
  }
  for (const g of latest.values()) {
    const lastQ = m.lastReported.get(g.company);
    const series = m.actual.get(g.company);
    const qs = g.quarters!;
    if (lastQ == null || !series) continue;
    const open = qs.filter((q) => q > lastQ && !series.has(q));
    // Only fill a period that continues straight on from reported data (no gap years).
    if (!open.length || lastQ < qs[0] - 1) continue;
    const reported = qs.filter((q) => series.has(q)).map((q) => series.get(q)!);
    const reportedYtd = reported.reduce((s, r) => s + onGuidanceBasis(r, g), 0);
    const remaining = g.mid! - reportedYtd;
    if (!(remaining > 0)) continue;
    const approx = g.includesLeases && reported.some((r) => r.headline == null);
    const cm = out.get(g.company) ?? new Map<number, ImpliedCell>();
    for (const q of open) cm.set(q, { v: remaining / open.length, guidance: g, reportedYtd, remaining, open: open.length, approx });
    out.set(g.company, cm);
  }
  return out;
}

export type CapexMode = 'quarterly' | 'annualized' | 'cumulative';

export interface ModeCell {
  v: number;
  ghost: boolean;
  /** quarters of actual data feeding this cell (for annualized/cumulative honesty in tooltips) */
  n: number;
}

/** Transform one company's quarterly series into the selected mode over [q0, q1]. */
export function modeSeries(
  q0: number,
  q1: number,
  actual: Map<number, CapexRow> | undefined,
  implied: Map<number, ImpliedCell> | undefined,
  mode: CapexMode,
  leases: boolean,
): (ModeCell | null)[] {
  const base: ({ v: number; ghost: boolean } | null)[] = [];
  for (let q = q0; q <= q1; q++) {
    const a = actual?.get(q);
    const im = implied?.get(q);
    base.push(a ? { v: capexValue(a, leases), ghost: false } : im ? { v: im.v, ghost: true } : null);
  }
  if (mode === 'quarterly') return base.map((b) => (b ? { ...b, n: b.ghost ? 0 : 1 } : null));
  if (mode === 'annualized') {
    return base.map((_, i) => {
      if (i < 3) return null;
      const w = base.slice(i - 3, i + 1);
      if (w.some((x) => !x)) return null;
      return { v: w.reduce((s, x) => s + x!.v, 0), ghost: w.some((x) => x!.ghost), n: w.filter((x) => !x!.ghost).length };
    });
  }
  // cumulative: running sum from the company's first quarter; gaps carry the total forward
  const firstI = base.findIndex((b) => b);
  let lastI = -1;
  base.forEach((b, i) => b && (lastI = i));
  let sum = 0;
  let ghost = false;
  let n = 0;
  return base.map((b, i) => {
    if (firstI < 0 || i < firstI || i > lastI) return null;
    if (b) {
      sum += b.v;
      ghost ||= b.ghost;
      if (!b.ghost) n++;
    }
    return { v: sum, ghost, n };
  });
}

export interface TtmStat {
  endQ: number;
  total: number;
  prev: number | null;
  yoy: number | null;
  companies: string[];
  likeForLike: boolean;
}

/** Trailing-4-quarter total ending at the latest quarter every company has reported. */
export function ttmStat(m: CapexModel, leases: boolean): TtmStat | null {
  const endQ = Math.min(...m.companies.map((c) => m.lastReported.get(c) ?? -Infinity));
  if (!Number.isFinite(endQ)) return null;
  const sumWin = (c: string, e: number) => {
    const s = m.actual.get(c);
    let t = 0;
    for (let q = e - 3; q <= e; q++) {
      const r = s?.get(q);
      if (!r) return null;
      t += capexValue(r, leases);
    }
    return t;
  };
  const cur = m.companies.map((c) => ({ c, v: sumWin(c, endQ), p: sumWin(c, endQ - 4) })).filter((x) => x.v != null);
  if (!cur.length) return null;
  const total = cur.reduce((s, x) => s + x.v!, 0);
  const both = cur.filter((x) => x.p != null);
  const likeForLike = both.length === cur.length;
  const prev = both.length ? both.reduce((s, x) => s + x.p!, 0) : null;
  const curLfl = both.reduce((s, x) => s + x.v!, 0);
  return { endQ, total, prev, yoy: prev ? curLfl / prev - 1 : null, companies: cur.map((x) => x.c), likeForLike };
}

// ── commitments ─────────────────────────────────────────────────────────────
export type CommitStatus = 'announced' | 'contracted' | 'revised' | 'cancelled';
export interface Commitment {
  id: string;
  date: string;
  t: number;
  company: string;
  counterparties: string[];
  title: string;
  usdBillions: number | null;
  gigawatts: number | null;
  horizon: string | null;
  status: CommitStatus;
  supersededBy: string | null;
  note: string | null;
  url: string | null;
}

export function parseCommitments(raw: unknown): Commitment[] {
  return arr<any>(raw)
    .map((c): Commitment | null => {
      const date = isoDay(c?.date);
      if (!c?.id || !date || !c.title) return null;
      const status = (['announced', 'contracted', 'revised', 'cancelled'] as const).includes(c.status) ? (c.status as CommitStatus) : 'announced';
      return {
        id: String(c.id),
        date,
        t: toTime(date),
        company: String(c.company ?? 'Unknown'),
        counterparties: arr<string>(c.counterparties).map(String),
        title: String(c.title),
        usdBillions: num(c.usdBillions),
        gigawatts: num(c.gigawatts),
        horizon: str(c.horizon),
        status,
        supersededBy: str(c.supersededBy),
        note: str(c.note),
        url: str(c.url),
      };
    })
    .filter((c): c is Commitment => !!c)
    .sort((a, b) => a.t - b.t);
}

// ── breakthroughs ───────────────────────────────────────────────────────────
export type Domain = 'math' | 'science';
export type Verification = 'formal-proof' | 'peer-reviewed' | 'expert-endorsed' | 'claimed' | 'disputed';
export type Autonomy = 'tool' | 'collaborative' | 'autonomous';
export const VERIFICATIONS: Verification[] = ['formal-proof', 'peer-reviewed', 'expert-endorsed', 'claimed', 'disputed'];
export const AUTONOMIES: Autonomy[] = ['tool', 'collaborative', 'autonomous'];
export const TIER_NAMES = ['Rediscovery', 'Interesting', 'Solid', 'Major', 'Breakthrough', 'Millennium/Nobel'];
export const tierName = (s: number) => TIER_NAMES[Math.max(0, Math.min(5, Math.floor(s)))];

export interface Breakthrough {
  id: string;
  date: string;
  t: number;
  title: string;
  domain: Domain;
  field: string | null;
  system: string | null;
  org: string | null;
  significance: number;
  verification: Verification;
  autonomy: Autonomy | null;
  summary: string | null;
  url: string;
  /** optional fields (breakthroughs.yaml): the specific model, the open problem it addressed, free tags, Alan's ASI checklist item */
  model: string | null;
  modelId: string | null;
  problem: string | null;
  tags: string[];
  alanRef: number | null;
}

export function parseBreakthroughs(raw: unknown): Breakthrough[] {
  return arr<any>(raw)
    .map((b): Breakthrough | null => {
      const date = isoDay(b?.date);
      const sig = num(b?.significance);
      if (!b?.id || !date || sig == null || !b.title) return null;
      return {
        id: String(b.id),
        date,
        t: toTime(date),
        title: String(b.title),
        domain: b.domain === 'math' ? 'math' : 'science',
        field: str(b.field),
        system: str(b.system),
        org: str(b.org),
        significance: Math.max(0, Math.min(5, sig)),
        verification: VERIFICATIONS.includes(b.verification) ? b.verification : 'claimed',
        autonomy: AUTONOMIES.includes(b.autonomy) ? b.autonomy : null,
        summary: str(b.summary),
        url: String(b.url ?? ''),
        model: str(b.model),
        modelId: str(b.modelId),
        problem: str(b.problem),
        tags: [...new Set(arr<unknown>(b.tags).map((x) => str(x)?.trim()).filter((x): x is string => !!x))],
        alanRef: num(b.alanRef),
      };
    })
    .filter((b): b is Breakthrough => !!b)
    .sort((a, b) => a.t - b.t);
}

/** Step series: count of items with significance ≥ k up to each item's date, extended to `until`. */
export function cumulativeAtLeast(items: Breakthrough[], k: number, until: number): [number, number][] {
  const hits = items.filter((b) => b.significance >= k).sort((a, b) => a.t - b.t);
  const out: [number, number][] = [];
  hits.forEach((b, i) => out.push([b.t, i + 1]));
  if (out.length && until > out[out.length - 1][0]) out.push([until, out.length]);
  return out;
}

// ── LEV ─────────────────────────────────────────────────────────────────────
/** Accepts a year (2036, 2036.5), 'YYYY', 'YYYY-MM' or an ISO date; returns a fractional year. */
export function toYearFrac(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 1000 && v < 3000 ? v : null;
  const d = isoDay(v);
  if (d) return yearFrac(d);
  const n = num(v);
  return n != null && n > 1000 && n < 3000 ? n : null;
}
const yearText = (v: unknown): string => {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  const d = isoDay(v);
  if (d) return d.slice(0, 4);
  return String(v);
};

export interface LevForecast {
  id: string;
  kind: 'metaculus' | 'named';
  source: string;
  published: string | null;
  /** point forecast (fractional year); null for range-only claims */
  median: number | null;
  low: number | null;
  high: number | null;
  rangeKind: 'iqr' | 'stated' | null;
  label: string;
  probability: number | null;
  forecasters: number | null;
  note: string | null;
  url: string | null;
}
export interface MetaculusPoint {
  date: string;
  median: number;
  q1: number | null;
  q3: number | null;
  forecasters: number | null;
}
export interface ManifoldMarket {
  question: string;
  probability: number | null;
  bettors: number | null;
  asOf: string | null;
  closes: string | null;
  resolved: boolean;
  resolution: string | null;
  note: string | null;
  url: string | null;
}
export interface LevAnnotation {
  n: number;
  date: string;
  x: number;
  title: string;
  category: string | null;
  summary: string | null;
  url: string | null;
}
export interface CohortCurve {
  age: number;
  actual: [number, number][];
  noProgress: [number, number][];
}
export interface TopToBottom {
  bestGuess: string | null;
  bestGuessUrl: string | null;
  candidates: { id: string; name: string; url: string | null }[];
  note: string | null;
  cohort: { method: string | null; source: string | null; baseYear: number; cohorts: CohortCurve[] } | null;
  e65Slopes: { country: string; window: string; slope: number }[];
}
export interface LevModel {
  definition: string | null;
  forecasts: LevForecast[];
  metaculusHistory: MetaculusPoint[];
  manifold: ManifoldMarket[];
  annotations: LevAnnotation[];
  curve: TopToBottom | null;
  recordSlopes: { window: string; slope: number }[];
  lifeExpectancyUrls: string[];
}

function collectUrls(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') {
    for (const m of v.matchAll(/https?:\/\/[^\s)"'<>]+/g)) out.push(m[0]);
  } else if (Array.isArray(v)) v.forEach((x) => collectUrls(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (/url/i.test(k) || typeof x === 'object') collectUrls(x, out);
  return [...new Set(out)];
}

function parseForecasts(f: any): { list: LevForecast[]; history: MetaculusPoint[]; manifold: ManifoldMarket[] } {
  const list: LevForecast[] = [];
  let history: MetaculusPoint[] = [];
  let manifold: ManifoldMarket[] = [];
  // Planned flat form: [{ date, source, median, url }]
  if (Array.isArray(f)) {
    f.forEach((x: any, i: number) => {
      const median = toYearFrac(x?.median);
      if (median == null) return;
      list.push({
        id: String(x.id ?? i),
        kind: /metaculus/i.test(String(x.source)) ? 'metaculus' : 'named',
        source: String(x.source ?? 'Forecast'),
        published: isoDay(x.date),
        median,
        low: null,
        high: null,
        rangeKind: null,
        label: yearText(x.median),
        probability: null,
        forecasters: null,
        note: str(x.note),
        url: str(x.url),
      });
    });
    return { list, history, manifold };
  }
  if (!f || typeof f !== 'object') return { list, history, manifold };
  const mc = f.metaculus;
  const cm = mc?.communityMedian;
  const med = toYearFrac(cm?.median);
  if (med != null) {
    list.push({
      id: 'metaculus',
      kind: 'metaculus',
      source: 'Metaculus',
      published: isoDay(cm.asOf),
      median: med,
      low: toYearFrac(cm.q1),
      high: toYearFrac(cm.q3),
      rangeKind: 'iqr',
      label: yearText(cm.median),
      probability: null,
      forecasters: num(cm.forecasters),
      note: str(mc.question ?? mc.title),
      url: str(mc.url),
    });
  }
  history = arr<any>(mc?.history)
    .map((h): MetaculusPoint | null => {
      const d = isoDay(h?.date);
      const m = toYearFrac(h?.median);
      return d && m != null ? { date: d, median: m, q1: toYearFrac(h.q1), q3: toYearFrac(h.q3), forecasters: num(h.forecasters) } : null;
    })
    .filter((h): h is MetaculusPoint => !!h)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const n of arr<any>(f.named)) {
    const range = Array.isArray(n?.levYearRange) ? n.levYearRange.map(num) : null;
    const point = num(n?.levYear);
    if (point == null && !(range && range[0] != null && range[1] != null)) {
      // No calendar year given (e.g. conditional claims): keep for the table only.
      list.push({ id: String(n?.id ?? n?.who), kind: 'named', source: String(n?.who ?? 'Named'), published: isoDay(n?.statedOn), median: null, low: null, high: null, rangeKind: null, label: 'no year', probability: num(n?.probability), forecasters: null, note: str(n?.claim), url: str(n?.url) });
      continue;
    }
    list.push({
      id: String(n.id ?? n.who),
      kind: 'named',
      source: String(n.who ?? 'Named'),
      published: isoDay(n.statedOn),
      median: point,
      low: point == null ? range![0] : null,
      high: point == null ? range![1] : null,
      rangeKind: point == null ? 'stated' : null,
      label: point != null ? String(point) : `${range![0]}–${range![1]}`,
      probability: num(n.probability),
      forecasters: null,
      note: str(n.claim),
      url: str(n.url),
    });
  }
  manifold = arr<any>(f.manifold).map((m) => ({
    question: String(m?.question ?? ''),
    probability: num(m?.probability),
    bettors: num(m?.bettors),
    asOf: isoDay(m?.asOf),
    closes: isoDay(m?.closes),
    resolved: m?.resolved === true,
    resolution: str(m?.resolution),
    note: str(m?.note),
    url: str(m?.url),
  }));
  return { list, history, manifold };
}

/** The latest statement per forecaster that carries a calendar year — what the chart marks. */
export function latestPerForecaster(fs: LevForecast[]): LevForecast[] {
  const by = new Map<string, LevForecast>();
  for (const f of fs) {
    if (f.median == null && f.low == null) continue;
    const p = by.get(f.source);
    if (!p || (f.published ?? '') > (p.published ?? '')) by.set(f.source, f);
  }
  return [...by.values()].sort((a, b) => (a.median ?? a.low!) - (b.median ?? b.low!));
}

function parseCurve(c: any): TopToBottom | null {
  if (!c || typeof c !== 'object') return null;
  const candidates = arr<any>(c.candidates).map((x) =>
    typeof x === 'string' ? { id: x, name: x, url: null } : { id: String(x?.id ?? x?.name), name: String(x?.name ?? x?.id ?? ''), url: str(x?.url) },
  );
  const best = candidates.find((x) => x.id === c.bestGuess);
  const cr = c.derived?.cohortRemainingLE;
  const years = arr(cr?.years).map(num);
  let cohort: TopToBottom['cohort'] = null;
  if (years.length && years.every((y) => y != null)) {
    const pts = (vals: unknown) => arr(vals).map((v, i) => [years[i]!, num(v)] as [number, number | null]).filter((p): p is [number, number] => p[1] != null && p[0] != null);
    const cohorts = arr<any>(cr.cohorts)
      .map((k) => ({ age: num(k?.ageIn1973 ?? k?.age) ?? NaN, actual: pts(k?.actual), noProgress: pts(k?.noProgress) }))
      .filter((k) => Number.isFinite(k.age) && k.actual.length > 1);
    if (cohorts.length) cohort = { method: str(cr.method), source: str(cr.source), baseYear: years[0]!, cohorts };
  }
  const e65Slopes = arr<any>(c.derived?.levGauge?.e65SlopeYearsPerYear)
    .map((s) => ({ country: String(s?.country ?? ''), window: Array.isArray(s?.window) ? s.window.join('–') : String(s?.window ?? ''), slope: num(s?.slope) }))
    .filter((s): s is { country: string; window: string; slope: number } => s.slope != null);
  return { bestGuess: best?.name ?? str(c.bestGuess), bestGuessUrl: best?.url ?? null, candidates, note: str(c.note), cohort, e65Slopes };
}

export function parseLev(raw: any): LevModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const { list, history, manifold } = parseForecasts(raw.forecasts);
  const annotations = arr<any>(raw.annotations)
    .map((a) => ({ a, d: isoDay(a?.date) }))
    .filter(({ a, d }) => d && a?.title)
    .sort((p, q) => (p.d! < q.d! ? -1 : 1))
    .map(({ a, d }, i): LevAnnotation => ({ n: i + 1, date: d!, x: yearFrac(d!), title: String(a.title), category: str(a.category), summary: str(a.summary ?? a.note), url: str(a.url) }));
  const recordSlopes = arr<any>(raw.recordTrend?.slopes)
    .map((s) => ({ window: Array.isArray(s?.window) ? s.window.join('–') : String(s?.window ?? ''), slope: num(s?.yearsPerYear) }))
    .filter((s): s is { window: string; slope: number } => s.slope != null);
  return {
    definition: str(raw.definition?.text ?? raw.definition),
    forecasts: list,
    metaculusHistory: history,
    manifold,
    annotations,
    curve: parseCurve(raw.topToBottomCurve),
    recordSlopes,
    lifeExpectancyUrls: collectUrls(raw.lifeExpectancyData),
  };
}

/** Life-expectancy bundle written by the OWID fetcher (charts.json → lifeExpectancy). */
export interface LifeExpectancy {
  /** record (best-practice) female period e0, with the holder */
  record: Map<number, { v: number; holder: string }>;
  /** country → year → remaining life expectancy at 0 / 65 / 80 */
  remaining: Map<string, Map<number, { e0: number | null; e65: number | null; e80: number | null }>>;
  sources: Record<string, string>;
  fetchedAt: string | null;
}

export function parseLifeExpectancy(raw: any): LifeExpectancy | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = new Map<number, { v: number; holder: string }>();
  for (const r of arr<any>(raw.record)) {
    const y = num(r?.year);
    const v = num(r?.value ?? r?.e0);
    if (y != null && v != null) record.set(y, { v, holder: String(r.country ?? r.entity ?? '') });
  }
  const remaining: LifeExpectancy['remaining'] = new Map();
  if (raw.remaining && typeof raw.remaining === 'object')
    for (const [c, rows] of Object.entries<any>(raw.remaining)) {
      const m = new Map<number, { e0: number | null; e65: number | null; e80: number | null }>();
      for (const r of arr<any>(rows)) {
        const y = num(r?.year);
        if (y != null) m.set(y, { e0: num(r.e0), e65: num(r.e65), e80: num(r.e80) });
      }
      if (m.size) remaining.set(c, m);
    }
  if (!record.size && !remaining.size) return null;
  const sources: Record<string, string> = {};
  if (raw.sources && typeof raw.sources === 'object') for (const [k, v] of Object.entries(raw.sources)) if (typeof v === 'string') sources[k] = v;
  return { record, remaining, sources, fetchedAt: str(raw.fetchedAt) };
}

/** Years of life expectancy gained per calendar year, 5-year rolling mean = (LE[y] − LE[y−5]) / 5. */
export function gainRate(series: Map<number, number>, window = 5): [number, number][] {
  const out: [number, number][] = [];
  for (const y of [...series.keys()].sort((a, b) => a - b)) {
    const a = series.get(y - window);
    if (a == null) continue;
    out.push([y, (series.get(y)! - a) / window]);
  }
  return out;
}

/** Ordinary least-squares slope of y on x. */
export function olsSlope(pts: [number, number][]): number | null {
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
  }
  return sxx ? sxy / sxx : null;
}

// ── survival curves ─────────────────────────────────────────────────────────
export interface SurvivalEra {
  era: string;
  order: number;
  speculative: boolean;
  source: string | null;
  points: [number, number][]; // [age, % surviving]
}

const SPECULATIVE = /\blev\b|speculative|hypothetical|illustrative|projection/i;

export function parseSurvival(rows: unknown): SurvivalEra[] {
  const byEra = new Map<string, { pts: [number, number][]; spec: boolean; source: string | null; idx: number; lx: boolean }>();
  arr<any>(rows).forEach((r, i) => {
    const era = str(r?.era ?? r?.period ?? r?.cohort ?? r?.year);
    const age = num(r?.age ?? r?.x);
    const pct = num(r?.survivingPct ?? r?.surviving ?? r?.pct);
    const lx = pct == null ? num(r?.lx) : null;
    if (!era || age == null || (pct == null && lx == null)) return;
    const e = byEra.get(era) ?? { pts: [], spec: false, source: null, idx: i, lx: pct == null };
    e.pts.push([age, (pct ?? lx)!]);
    const flag = String(r?.speculative ?? r?.kind ?? r?.type ?? '');
    if (/^(true|1|yes|speculative|projection|lev)$/i.test(flag) || SPECULATIVE.test(era)) e.spec = true;
    e.source ??= str(r?.source);
    byEra.set(era, e);
  });
  const eras = [...byEra.entries()].map(([era, e]) => {
    let pts = e.pts.sort((a, b) => a[0] - b[0]);
    if (e.lx) {
      const radix = pts[0]?.[1] || 1;
      pts = pts.map(([a, v]) => [a, (v / radix) * 100] as [number, number]);
    }
    const yr = /(1[5-9]\d{2}|20\d{2}|21\d{2})/.exec(era);
    return { era, order: yr ? Number(yr[1]) : 1e4 + e.idx, speculative: e.spec, source: e.source, points: pts };
  });
  return eras.sort((a, b) => Number(a.speculative) - Number(b.speculative) || a.order - b.order);
}

/** Age at which the curve crosses 50% surviving (linear interpolation). */
export function medianAge(points: [number, number][]): number | null {
  for (let i = 1; i < points.length; i++) {
    const [a0, v0] = points[i - 1];
    const [a1, v1] = points[i];
    if (v0 >= 50 && v1 < 50) return a0 + ((v0 - 50) / (v0 - v1)) * (a1 - a0);
  }
  return null;
}
