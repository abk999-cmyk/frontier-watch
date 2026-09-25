import { describe, expect, it } from 'vitest';
import { buildDriftModel } from './drift.ts';
import {
  AI2040_EMPTY,
  DRIFT_EMPTY,
  effectiveStatus,
  filterAi2040,
  filterDriftModel,
  filterMilestones,
  filterProxies,
  lagDomain,
  matchStage,
  PROXY_EMPTY,
  proxiesInView,
  proxySortValue,
  stagedPlanId,
  TRACK_EMPTY,
  trackActive,
  type ProxyRow,
} from './filters.ts';
import { proxyLag } from './lag.ts';
import type { ForecastUpdate, Milestone, Plan, Proxy, Stage } from './types.ts';

const NOW = '2026-09-24';

const ms = (id: string, date: string, branch: Milestone['branch'], status: Milestone['status'], extra: Partial<Milestone> = {}): Milestone => ({ id, date, branch, status, title: id, ...extra });
const MILESTONES = [
  ms('stumbling-agents', '2025-08-01', 'shared', 'hit', { title: 'Mid 2025: Stumbling Agents', claims: [{ metric: 'osworld', value: 65 }] }),
  ms('agent-0', '2025-12-01', 'shared', 'partial', { proxy: 'compute-1e27' }),
  ms('coder', '2027-03-01', 'shared', 'n/a', { summary: 'Superhuman coder arrives' }),
  ms('race-end', '2030-01-01', 'race', 'n/a'),
  ms('slow-end', '2028-06-01', 'slowdown', 'n/a'),
  ms('old-ungraded', '2026-01-01', 'shared', 'n/a'),
];
const proxy = (id: string, extra: Partial<Proxy>): Proxy => ({ id, name: id, scenarioDate: '2025-12-01', status: 'not-yet', weight: 1, ...extra });
const PROXIES = [
  proxy('compute-1e27', { metric: 'trainingFlop', status: 'reached', realityDate: '2026-09-03' }),
  proxy('sc', { scenarioRef: 'coder', scenarioDate: '2027-03-01', projectedDate: '2028-01-01', metric: 'capabilityMilestone' }),
  proxy('revenue', { scenarioDate: '2026-02-01', status: 'reached', realityDate: '2025-10-01', weight: 0.5, metric: 'revenueAnnualized', note: 'OpenAI annualized revenue' }),
  proxy('orphan', { scenarioDate: '2026-01-01' }),
];

describe('effectiveStatus', () => {
  it('turns ungraded future milestones into "future", keeps past ones ungraded', () => {
    expect(effectiveStatus(MILESTONES[2], NOW)).toBe('future');
    expect(effectiveStatus(MILESTONES[5], NOW)).toBe('n/a');
    expect(effectiveStatus(MILESTONES[0], NOW)).toBe('hit');
  });
});

describe('track filters', () => {
  const ctx = { now: NOW, proxies: PROXIES };
  const ids = (f: typeof TRACK_EMPTY, skip?: Parameters<typeof filterMilestones>[3]) => filterMilestones(MILESTONES, f, ctx, skip).map((m) => m.id);
  it('passes everything with no filter', () => {
    expect(ids(TRACK_EMPTY)).toHaveLength(MILESTONES.length);
    expect(trackActive(TRACK_EMPTY)).toBe(false);
  });
  it('filters by branch, effective status and date', () => {
    expect(ids({ ...TRACK_EMPTY, branches: ['race', 'slowdown'] })).toEqual(['race-end', 'slow-end']);
    expect(ids({ ...TRACK_EMPTY, statuses: ['future'] })).toEqual(['coder', 'race-end', 'slow-end']);
    expect(ids({ ...TRACK_EMPTY, statuses: ['n/a'] })).toEqual(['old-ungraded']);
    expect(ids({ ...TRACK_EMPTY, date: { mode: 'before', to: NOW } })).toEqual(['stumbling-agents', 'agent-0', 'old-ungraded']);
  });
  it('"has proxy" follows both link directions', () => {
    expect(ids({ ...TRACK_EMPTY, hasProxy: true })).toEqual(['agent-0', 'coder']);
  });
  it('searches titles, summaries and claim metrics', () => {
    expect(ids({ ...TRACK_EMPTY, q: 'superhuman' })).toEqual(['coder']);
    expect(ids({ ...TRACK_EMPTY, q: 'osworld' })).toEqual(['stumbling-agents']);
  });
  it('skips a facet for its own counts', () => {
    const f = { ...TRACK_EMPTY, branches: ['race'], statuses: ['hit'] };
    expect(ids(f)).toEqual([]);
    expect(ids(f, 'statuses')).toEqual(['race-end']);
    expect(ids(f, 'branches')).toEqual(['stumbling-agents']);
  });
  it('keeps proxies bright only when linked to a matching milestone', () => {
    const all = proxiesInView(PROXIES, MILESTONES, new Set(), false);
    expect(all.size).toBe(PROXIES.length);
    const some = proxiesInView(PROXIES, MILESTONES, new Set(['coder']), true);
    expect([...some]).toEqual(['sc']);
  });
});

describe('proxy ledger filters', () => {
  const rows: ProxyRow[] = PROXIES.map((p) => ({ p, l: proxyLag(p, NOW) }));
  const ids = (f: typeof PROXY_EMPTY) => filterProxies(rows, f).map((r) => r.p.id);
  it('filters by status, weight, metric and search', () => {
    expect(ids({ ...PROXY_EMPTY, statuses: ['reached'] })).toEqual(['compute-1e27', 'revenue']);
    expect(ids({ ...PROXY_EMPTY, weights: ['0.5'] })).toEqual(['revenue']);
    expect(ids({ ...PROXY_EMPTY, metrics: ['trainingFlop', 'unspecified'] })).toEqual(['compute-1e27', 'orphan']);
    expect(ids({ ...PROXY_EMPTY, q: 'annualized openai' })).toEqual(['revenue']);
  });
  it('filters by lag range and drops uncounted proxies once a range is set', () => {
    // compute-1e27 ≈ +9.1, sc projected ≈ +10, revenue ≈ −4, orphan lower bound ≈ +8.8
    expect(ids({ ...PROXY_EMPTY, lag: { max: 0 } })).toEqual(['revenue']);
    expect(ids({ ...PROXY_EMPTY, lag: { min: 9 } })).toEqual(['compute-1e27', 'sc']);
    const excluded = { p: proxy('x', { scenarioDate: '2030-01-01' }), l: proxyLag(proxy('x', { scenarioDate: '2030-01-01' }), NOW) };
    expect(excluded.l.months).toBeNull();
    expect(filterProxies([excluded], { ...PROXY_EMPTY, lag: { min: -100 } })).toEqual([]);
  });
  it('builds a whole-month lag domain around zero', () => {
    expect(lagDomain([9.07, -4.2, null])).toEqual([-5, 10]);
    expect(lagDomain([2.5])).toEqual([0, 3]);
    expect(lagDomain([])).toEqual([0, 1]);
  });
  it('exposes sortable values, blank when reality is unknown', () => {
    const orphan = rows.find((r) => r.p.id === 'orphan')!;
    expect(proxySortValue(orphan, 'reality')).toBeNull();
    expect(proxySortValue(rows[0], 'reality')).toBe('2026-09-03');
    expect(proxySortValue(rows[2], 'weight')).toBe(0.5);
  });
});

describe('drift filters', () => {
  const updates: ForecastUpdate[] = [
    { forecaster: 'Daniel Kokotajlo', published: '2025-04-03', milestone: 'automated-coder', median: '2027-06-01' },
    { forecaster: 'Daniel Kokotajlo', published: '2025-12-01', milestone: 'automated-coder', median: '2029-01-01' },
    { forecaster: 'Eli Lifland', published: '2025-04-03', milestone: 'asi', median: '2031-01-01' },
    { forecaster: 'Nikola Jurkovic', published: '2025-06-01', milestone: 'agi', median: '2030-01-01' },
  ];
  const full = buildDriftModel(updates);
  it('filters rows and charted points together', () => {
    const m = filterDriftModel(full, { ...DRIFT_EMPTY, forecasters: ['Daniel Kokotajlo'] });
    expect(m.rows).toHaveLength(2);
    expect(m.keys).toEqual(['ac']);
    expect(m.forecasters).toEqual(['Daniel Kokotajlo']);
  });
  it('keeps forecaster marks stable under filtering', () => {
    const m = filterDriftModel(full, { ...DRIFT_EMPTY, forecasters: ['Eli Lifland'] });
    expect(m.marks.get('Eli Lifland')).toEqual(full.marks.get('Eli Lifland'));
  });
  it('filters table-only milestones by their raw name, and by published date', () => {
    expect(filterDriftModel(full, { ...DRIFT_EMPTY, milestones: ['raw:agi'] }).rows.map((r) => r.forecaster)).toEqual(['Nikola Jurkovic']);
    expect(filterDriftModel(full, { ...DRIFT_EMPTY, milestones: ['raw:agi'] }).charted).toEqual([]);
    expect(filterDriftModel(full, { ...DRIFT_EMPTY, published: { mode: 'after', from: '2025-05-01' } }).rows).toHaveLength(2);
  });
});

describe('AI 2040 filters', () => {
  const stage = (year: number, title: string, pre: [string, Stage['preconditions'][number]['status']][], summary = ''): Stage => ({
    year,
    title,
    url: null,
    summary,
    preconditions: pre.map(([text, status]) => ({ text, status, evidence: null, url: null })),
    branchPoints: [],
  });
  const STAGES = [
    stage(2027, 'The Writing on the Wall', [
      ['Frontier transparency law', 'partial'],
      ['Whistleblower protections', 'partial'],
      ['Compute tracking', 'not-yet'],
    ]),
    stage(2029, 'Choose a Path', [['US–China talks', 'not-yet']], 'The fork'),
    stage(2031, 'Safety Cases', [['Alignment safety cases', 'happened']], 'Labs publish safety cases'),
  ];
  const PLANS: Plan[] = [
    { id: 'B', name: 'Sabotage', subtitle: null, summary: null, url: null },
    { id: 'A', name: 'The Deal', subtitle: null, summary: null, url: null },
  ];
  it('finds the staged plan', () => {
    expect(stagedPlanId(PLANS)).toBe('A');
    expect(stagedPlanId([PLANS[0]])).toBe('B');
    expect(stagedPlanId([])).toBeNull();
  });
  it('marks matching preconditions and collapses stages with none', () => {
    const m = matchStage(STAGES[0], { q: '', statuses: ['partial'] });
    expect(m.hits).toEqual([true, true, false]);
    expect(m.matched).toBe(true);
    expect(matchStage(STAGES[2], { q: '', statuses: ['partial'] }).matched).toBe(false);
  });
  it('searches stage text and preconditions', () => {
    const t = matchStage(STAGES[0], { q: 'whistleblower', statuses: [] });
    expect(t.hits).toEqual([false, true, false]);
    const title = matchStage(STAGES[2], { q: 'safety cases', statuses: [] });
    expect(title.titleHit).toBe(true);
    expect(title.matched).toBe(true);
    // a title hit doesn't survive a status filter that leaves the stage nothing to show
    expect(matchStage(STAGES[2], { q: 'safety cases', statuses: ['not-yet'] }).matched).toBe(false);
  });
  it('scopes by year and plan', () => {
    expect(filterAi2040(STAGES, PLANS, { ...AI2040_EMPTY, years: { max: 2029 } }).shown.map((m) => m.stage.year)).toEqual([2027, 2029]);
    const b = filterAi2040(STAGES, PLANS, { ...AI2040_EMPTY, plans: ['B'] });
    expect(b.afterForkHidden).toBe(true);
    expect(b.shown.map((m) => m.stage.year)).toEqual([2027, 2029]);
    expect(filterAi2040(STAGES, PLANS, { ...AI2040_EMPTY, plans: ['A', 'B'] }).afterForkHidden).toBe(false);
  });
  it('counts matched stages', () => {
    expect(filterAi2040(STAGES, PLANS, AI2040_EMPTY).matchedCount).toBe(3);
    expect(filterAi2040(STAGES, PLANS, { ...AI2040_EMPTY, statuses: ['not-yet'] }).matchedCount).toBe(2);
  });
});
