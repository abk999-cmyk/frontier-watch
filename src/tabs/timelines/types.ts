// Client-side shapes for public/data/timelines.json, plus defensive normalisers.
// The build validates ai2027 / proxies / updates with zod (scripts/lib/schemas.ts);
// ai2040 is passed through raw, so every field here is guarded.

export type MilestoneStatus = 'hit' | 'partial' | 'not-yet' | 'missed' | 'n/a';
export type Branch = 'shared' | 'race' | 'slowdown';

export interface Claim {
  metric: string;
  value?: unknown;
  note?: string | null;
}

export interface Milestone {
  id: string;
  date: string;
  datePrecision?: string | null;
  branch: Branch;
  title: string;
  summary?: string | null;
  claims?: Claim[] | null;
  status: MilestoneStatus;
  statusNote?: string | null;
  evidenceUrl?: string | null;
  proxy?: string | null;
}

export interface Proxy {
  id: string;
  name: string;
  metric?: string | null;
  scenarioDate: string;
  scenarioRef?: string | null;
  scenarioValue?: unknown;
  realityDate?: string | null;
  realityRef?: string | null;
  status: 'reached' | 'not-yet';
  projectedDate?: string | null;
  projectionNote?: string | null;
  weight: number;
  note?: string | null;
  sources?: string[] | null;
}

export interface ForecastUpdate {
  forecaster: string;
  published: string;
  milestone: string;
  median: string;
  note?: string | null;
  url?: string | null;
}

export interface Ai2027 {
  source: string | null;
  published: string | null;
  milestones: Milestone[];
}

export type PreconditionStatus = 'happened' | 'partial' | 'not-yet' | 'unknown';
export interface Precondition {
  text: string;
  status: PreconditionStatus;
  evidence: string | null;
  url: string | null;
}
export interface Stage {
  year: number;
  title: string;
  url: string | null;
  summary: string | null;
  preconditions: Precondition[];
  /** off-ramps the scenario explores at this stage */
  branchPoints: string[];
}
export interface Plan {
  id: string;
  name: string;
  subtitle: string | null;
  summary: string | null;
  url: string | null;
}
export interface Metric {
  year: number;
  name: string;
  value: number;
  unit: string | null;
  note: string | null;
}
export interface Ai2040 {
  source: string | null;
  published: string | null;
  statusAsOf: string | null;
  framing: string | null;
  plans: Plan[];
  stages: Stage[];
  metrics: Metric[];
}

export interface Timelines {
  ai2027: Ai2027 | null;
  proxies: Proxy[];
  updates: ForecastUpdate[];
  ai2040: Ai2040 | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** YAML may hand us Date objects serialised as ISO timestamps; keep the calendar date. */
const date = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return `${Math.trunc(v)}-01-01`;
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(s);
  if (!m) return null;
  return `${m[1]}-${m[2] ?? '01'}-${m[3] ?? '01'}`;
};
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const PRE_STATUS: PreconditionStatus[] = ['happened', 'partial', 'not-yet'];

export function normalizeAi2040(raw: unknown): Ai2040 | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = obj(raw);
  const stages: Stage[] = arr(r.stages)
    .map((s) => {
      const o = obj(s);
      const year = num(o.year) ?? num(date(o.year)?.slice(0, 4));
      const title = str(o.title);
      if (year == null || !title) return null;
      const preconditions: Precondition[] = arr(o.preconditions)
        .map((p) => {
          const po = obj(p);
          const text = str(po.text) ?? (typeof p === 'string' ? str(p) : null);
          if (!text) return null;
          const st = str(po.status);
          return {
            text,
            status: (PRE_STATUS as string[]).includes(st ?? '') ? (st as PreconditionStatus) : 'unknown',
            evidence: str(po.evidence),
            url: str(po.url),
          };
        })
        .filter((p): p is Precondition => p !== null);
      const branchPoints = arr(o.branchPoints).map(str).filter((b): b is string => b !== null);
      return { year, title, url: str(o.url), summary: str(o.summary), preconditions, branchPoints };
    })
    .filter((s): s is Stage => s !== null)
    .sort((a, b) => a.year - b.year);
  const plans: Plan[] = arr(r.plans)
    .map((p) => {
      const o = obj(p);
      const name = str(o.name) ?? str(o.id);
      if (!name) return null;
      return { id: str(o.id) ?? name, name, subtitle: str(o.subtitle), summary: str(o.summary), url: str(o.url) };
    })
    .filter((p): p is Plan => p !== null);
  const metrics: Metric[] = arr(r.metrics)
    .map((m) => {
      const o = obj(m);
      const year = num(o.year);
      const name = str(o.name);
      const value = num(o.value);
      if (year == null || !name || value == null) return null;
      return { year, name, value, unit: str(o.unit), note: str(o.note) };
    })
    .filter((m): m is Metric => m !== null);
  return { source: str(r.source), published: date(r.published), statusAsOf: date(r.statusAsOf), framing: str(r.framing), plans, stages, metrics };
}

export function normalizeTimelines(raw: unknown): Timelines {
  const r = obj(raw);
  const a = r.ai2027 ? obj(r.ai2027) : null;
  const ai2027: Ai2027 | null = a
    ? {
        source: str(a.source),
        published: date(a.published),
        milestones: arr(a.milestones).filter((m): m is Milestone => {
          const o = obj(m);
          return !!str(o.id) && !!date(o.date) && !!str(o.title);
        }),
      }
    : null;
  return {
    ai2027,
    proxies: arr(r.proxies).filter((p): p is Proxy => !!str(obj(p).id) && !!date(obj(p).scenarioDate)),
    updates: arr(r.updates).filter((u): u is ForecastUpdate => {
      const o = obj(u);
      return !!str(o.forecaster) && !!date(o.published) && !!date(o.median) && !!str(o.milestone);
    }),
    ai2040: normalizeAi2040(r.ai2040),
  };
}
