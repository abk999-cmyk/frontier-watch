// Pure filter logic for the Timelines tab (no React). Tested in filters.test.ts.

import { inRange, isDateActive, isRangeActive, matchAny, matchDate, textMatch, type DateFilterValue, type RangeValue } from '../../lib/filters.ts';
import type { DriftModel, DriftRow } from './drift.ts';
import type { ProxyLag } from './lag.ts';
import type { Milestone, MilestoneStatus, Plan, Precondition, Proxy, Stage } from './types.ts';

/** n/a milestones dated after today are "future"; everything else keeps its graded status. */
export const effectiveStatus = (m: Milestone, now: string): MilestoneStatus | 'future' => (m.status === 'n/a' && m.date > now ? 'future' : m.status);

// ── AI 2027 track ───────────────────────────────────────────────────────────
export interface TrackFilter {
  q: string;
  branches: string[];
  statuses: string[];
  date: DateFilterValue;
  hasProxy: boolean;
}
export type TrackFacet = keyof TrackFilter;
export const TRACK_EMPTY: TrackFilter = { q: '', branches: [], statuses: [], date: { mode: 'any' }, hasProxy: false };

export const trackActive = (f: TrackFilter) => !!f.q.trim() || f.branches.length > 0 || f.statuses.length > 0 || isDateActive(f.date) || f.hasProxy;

export const milestoneHaystack = (m: Milestone) =>
  [m.title, m.summary, m.statusNote, ...(m.claims ?? []).flatMap((c) => [c.metric, c.note, typeof c.value === 'string' || typeof c.value === 'number' ? String(c.value) : ''])].filter(Boolean).join(' ');

/** Proxies measuring this milestone: the ones pointing at it, plus the one it names. */
export const linkedProxies = (m: Milestone, proxies: Proxy[]) => proxies.filter((p) => p.scenarioRef === m.id || (!!m.proxy && p.id === m.proxy));

export function matchMilestone(m: Milestone, f: TrackFilter, ctx: { now: string; proxies: Proxy[] }, skip?: TrackFacet): boolean {
  return (
    (skip === 'q' || textMatch(milestoneHaystack(m), f.q)) &&
    (skip === 'branches' || matchAny(m.branch, f.branches)) &&
    (skip === 'statuses' || matchAny(effectiveStatus(m, ctx.now), f.statuses)) &&
    (skip === 'date' || matchDate(m.date, f.date)) &&
    (skip === 'hasProxy' || !f.hasProxy || linkedProxies(m, ctx.proxies).length > 0)
  );
}
export const filterMilestones = (ms: Milestone[], f: TrackFilter, ctx: { now: string; proxies: Proxy[] }, skip?: TrackFacet) => ms.filter((m) => matchMilestone(m, f, ctx, skip));

/**
 * Proxies that stay bright on the track while milestones are filtered: those linked to a matching
 * milestone. A proxy linked to no milestone at all only stays bright while no filter is on.
 */
export function proxiesInView(proxies: Proxy[], milestones: Milestone[], matched: Set<string>, active: boolean): Set<string> {
  if (!active) return new Set(proxies.map((p) => p.id));
  const out = new Set<string>();
  for (const m of milestones) if (matched.has(m.id)) for (const p of linkedProxies(m, proxies)) out.add(p.id);
  return out;
}

// ── Proxy ledger ────────────────────────────────────────────────────────────
export interface ProxyRow {
  p: Proxy;
  l: ProxyLag;
}
export interface ProxyFilter {
  q: string;
  statuses: string[];
  weights: string[];
  lag: RangeValue;
  metrics: string[];
}
export type ProxyFacet = keyof ProxyFilter;
export const PROXY_EMPTY: ProxyFilter = { q: '', statuses: [], weights: [], lag: {}, metrics: [] };
export const proxyActive = (f: ProxyFilter) => !!f.q.trim() || f.statuses.length > 0 || f.weights.length > 0 || isRangeActive(f.lag) || f.metrics.length > 0;

export const proxyMetric = (p: Proxy) => p.metric ?? 'unspecified';
export const proxyHaystack = (p: Proxy) => [p.name, p.metric, p.realityRef, p.note, p.projectionNote, p.scenarioRef].filter(Boolean).join(' ');

export function matchProxy(r: ProxyRow, f: ProxyFilter, skip?: ProxyFacet): boolean {
  return (
    (skip === 'q' || textMatch(proxyHaystack(r.p), f.q)) &&
    (skip === 'statuses' || matchAny(r.p.status, f.statuses)) &&
    (skip === 'weights' || matchAny(String(r.p.weight), f.weights)) &&
    (skip === 'lag' || inRange(r.l.months, f.lag)) &&
    (skip === 'metrics' || matchAny(proxyMetric(r.p), f.metrics))
  );
}
export const filterProxies = (rows: ProxyRow[], f: ProxyFilter, skip?: ProxyFacet) => rows.filter((r) => matchProxy(r, f, skip));

/** Whole-month lag domain that always includes 0 (on schedule). */
export function lagDomain(lags: (number | null)[]): [number, number] {
  const xs = lags.filter((v): v is number => v != null && Number.isFinite(v));
  const lo = Math.floor(Math.min(0, ...xs));
  const hi = Math.ceil(Math.max(0, ...xs));
  return [lo, hi > lo ? hi : lo + 1];
}

export type ProxySortKey = 'name' | 'scenario' | 'reality' | 'lag' | 'status' | 'weight';
export function proxySortValue(r: ProxyRow, key: ProxySortKey): string | number | null {
  switch (key) {
    case 'name':
      return r.p.name;
    case 'scenario':
      return r.p.scenarioDate;
    case 'reality':
      return r.l.kind === 'reached' || r.l.kind === 'projected' ? r.l.endDate : null;
    case 'lag':
      return r.l.months;
    case 'status':
      return r.p.status;
    case 'weight':
      return r.p.weight;
  }
}

// ── Forecast drift ──────────────────────────────────────────────────────────
export interface DriftFilter {
  forecasters: string[];
  milestones: string[];
  published: DateFilterValue;
}
export type DriftFacet = keyof DriftFilter;
export const DRIFT_EMPTY: DriftFilter = { forecasters: [], milestones: [], published: { mode: 'any' } };
export const driftActive = (f: DriftFilter) => f.forecasters.length > 0 || f.milestones.length > 0 || isDateActive(f.published);

/** Canonical milestone key, or the raw name for milestones the chart doesn't plot. */
export const driftMilestone = (r: Pick<DriftRow, 'key' | 'milestone'>) => r.key ?? `raw:${r.milestone}`;

export const matchDrift = (r: DriftRow, f: DriftFilter, skip?: DriftFacet) =>
  (skip === 'forecasters' || matchAny(r.forecaster, f.forecasters)) && (skip === 'milestones' || matchAny(driftMilestone(r), f.milestones)) && (skip === 'published' || matchDate(r.published, f.published));

/** Filter a drift model without re-deriving forecaster marks, so line styles never shift. */
export function filterDriftModel(m: DriftModel, f: DriftFilter): DriftModel {
  const rows = m.rows.filter((r) => matchDrift(r, f));
  const charted = m.charted.filter((r) => matchDrift(r, f));
  return {
    rows,
    charted,
    keys: m.keys.filter((k) => charted.some((r) => r.key === k)),
    forecasters: m.forecasters.filter((x) => charted.some((r) => r.forecaster === x)),
    marks: m.marks,
  };
}

// ── AI 2040 ─────────────────────────────────────────────────────────────────
/** The year the scenario forks into its five plans. */
export const FORK_YEAR = 2029;

export interface Ai2040Filter {
  q: string;
  statuses: string[];
  years: RangeValue;
  plans: string[];
}
export const AI2040_EMPTY: Ai2040Filter = { q: '', statuses: [], years: {}, plans: [] };
export const ai2040Active = (f: Ai2040Filter) => !!f.q.trim() || f.statuses.length > 0 || isRangeActive(f.years) || f.plans.length > 0;

/** The plan the page's stages follow (Plan A, else the first listed). */
export const stagedPlanId = (plans: Plan[]) => (plans.find((p) => /^(plan[- ]?)?a$/i.test(p.id)) ?? plans[0])?.id ?? null;

export interface StageMatch {
  stage: Stage;
  /** per precondition: passes the status + search filters (only meaningful while filtering) */
  hits: boolean[];
  /** the search matched the stage's own title / summary / off-ramps */
  titleHit: boolean;
  /** anything in the stage matches; false = the card collapses */
  matched: boolean;
}

const preHaystack = (p: Precondition) => `${p.text} ${p.evidence ?? ''}`;
const stageHaystack = (s: Stage) => [s.title, s.summary, ...s.branchPoints].filter(Boolean).join(' ');

export function matchStage(s: Stage, f: Pick<Ai2040Filter, 'q' | 'statuses'>): StageMatch {
  const q = f.q.trim();
  const filtering = !!q || f.statuses.length > 0;
  const hits = s.preconditions.map((p) => matchAny(p.status, f.statuses) && (!q || textMatch(preHaystack(p), q)));
  const titleHit = !!q && textMatch(stageHaystack(s), q);
  // A title/summary hit keeps the stage open unless a status filter leaves it no precondition to show.
  const statusOk = !f.statuses.length || s.preconditions.some((p) => matchAny(p.status, f.statuses));
  const matched = !filtering || hits.some(Boolean) || (titleHit && statusOk);
  return { stage: s, hits, titleHit, matched };
}

export interface Ai2040View {
  /** stages inside the year window and the plan scope, in order */
  shown: StageMatch[];
  /** stages after the fork are hidden because the picked plans don't include the staged one */
  afterForkHidden: boolean;
  matchedCount: number;
}

export function filterAi2040(stages: Stage[], plans: Plan[], f: Ai2040Filter): Ai2040View {
  const staged = stagedPlanId(plans);
  const afterForkHidden = f.plans.length > 0 && !!staged && !f.plans.includes(staged);
  const shown = stages.filter((s) => inRange(s.year, f.years) && !(afterForkHidden && s.year > FORK_YEAR)).map((s) => matchStage(s, f));
  return { shown, afterForkHidden, matchedCount: shown.filter((m) => m.matched).length };
}
