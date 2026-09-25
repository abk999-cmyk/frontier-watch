import { describe, expect, it } from 'vitest';
import {
  buildCapexModel,
  cumulativeAtLeast,
  gainRate,
  hash01,
  impliedFromGuidance,
  latestPerForecaster,
  medianAge,
  modeSeries,
  olsSlope,
  parseBreakthroughs,
  parseLev,
  parseSurvival,
  qIndex,
  qKey,
  ttmStat,
} from './cbData.ts';

const q = (s: string) => qIndex(s);
const rows = (company: string, from: string, vals: number[]) => vals.map((capex, i) => ({ company, quarter: qKey(q(from) + i), capex, financeLeases: 1 }));

describe('quarters', () => {
  it('round-trips', () => {
    expect(qKey(q('2026-Q3'))).toBe('2026-Q3');
    expect(q('2026-Q1') - q('2025-Q4')).toBe(1);
  });
});

describe('capex', () => {
  const raw = {
    quarters: [...rows('microsoft', '2024-Q3', [10, 10, 10, 10, 10, 10, 20, 20]), ...rows('google', '2024-Q3', [5, 5, 5, 5, 5, 5, 6, 6])],
    guidance: [
      { company: 'google', year: 2026, period: 'CY2026', low: 28, high: 32, basis: 'purchases of property and equipment', stated: '2026-07-01' },
      { company: 'microsoft', year: 2026, period: 'CY2026', low: 100, high: 100, basis: 'capex including finance leases', stated: '2026-07-01' },
    ],
  };
  const m = buildCapexModel(raw)!;

  it('canonicalises companies into the fixed order', () => {
    expect(m.companies).toEqual(['Microsoft', 'Alphabet']);
  });

  it('spreads the unreported remainder of guidance on the guidance basis', () => {
    const im = impliedFromGuidance(m);
    // Alphabet: (30 − 12) / 2 quarters left
    expect(im.get('Alphabet')!.get(q('2026-Q3'))!.v).toBeCloseTo(9);
    // Microsoft guides incl. finance leases: (100 − (21 + 21)) / 2
    expect(im.get('Microsoft')!.get(q('2026-Q4'))!.v).toBeCloseTo(29);
    expect(im.get('Microsoft')!.get(q('2026-Q4'))!.approx).toBe(true);
  });

  it('maps a fiscal-year span to calendar quarters by the middle month', () => {
    const o = buildCapexModel({
      quarters: rows('oracle', '2026-Q2', [10, 10]),
      guidance: [{ company: 'oracle', year: 2027, period: 'FY2027 (Jun 2026-May 2027)', low: 90, high: 90 }],
    })!;
    const im = impliedFromGuidance(o).get('Oracle')!;
    expect([...im.keys()].map(qKey)).toEqual(['2026-Q4', '2027-Q1', '2027-Q2']);
    expect(im.get(q('2027-Q2'))!.v).toBeCloseTo(80 / 3);
  });

  it('computes annualized and cumulative series, flagging implied quarters as ghosts', () => {
    const im = impliedFromGuidance(m);
    const a = modeSeries(q('2025-Q1'), q('2026-Q4'), m.actual.get('Alphabet'), im.get('Alphabet'), 'annualized', false);
    expect(a[2]).toBeNull();
    expect(a[3]).toMatchObject({ v: 20, ghost: false });
    expect(a[7]).toMatchObject({ v: 30, ghost: true }); // CY2026 = guided midpoint
    const c = modeSeries(q('2025-Q1'), q('2026-Q1'), m.actual.get('Alphabet'), undefined, 'cumulative', true);
    expect(c.at(-1)!.v).toBe(6 * 4 + 7); // capex + finance leases
  });

  it('trailing-4Q stat ends at the latest quarter every company reported', () => {
    const s = ttmStat(m, false)!;
    expect(qKey(s.endQ)).toBe('2026-Q2');
    expect(s.total).toBe(10 + 10 + 20 + 20 + 5 + 5 + 6 + 6);
    expect(s.yoy).toBeCloseTo(82 / 60 - 1);
  });
});

describe('LEV', () => {
  it('reads the metaculus + named forecast shape and keeps the latest per forecaster', () => {
    const lev = parseLev({
      forecasts: {
        metaculus: { url: 'u', communityMedian: { asOf: '2026-09-17', q1: '2038-05-13', median: '2053-05-03', q3: '2110-07-13', forecasters: 149 } },
        named: [
          { id: 'a', who: 'A', statedOn: '2021-01-01', levYear: 2036 },
          { id: 'b', who: 'A', statedOn: '2022-01-01', levYear: 2037 },
          { id: 'c', who: 'K', statedOn: '2024-01-01', levYearRange: [2029, 2035] },
          { id: 'd', who: 'D', statedOn: '2024-01-01', claim: 'no year' },
        ],
      },
    })!;
    expect(lev.forecasts.find((f) => f.kind === 'metaculus')!.label).toBe('2053');
    expect(latestPerForecaster(lev.forecasts).map((f) => `${f.source} ${f.label}`)).toEqual(['K 2029–2035', 'A 2037', 'Metaculus 2053']);
  });

  it('5-year gain rate and OLS slope', () => {
    const s = new Map([2000, 2001, 2002, 2003, 2004, 2005, 2006].map((y) => [y, 80 + (y - 2000) * 0.25]));
    expect(gainRate(s)).toEqual([
      [2005, 0.25],
      [2006, 0.25],
    ]);
    expect(olsSlope([...s])).toBeCloseTo(0.25);
  });

  it('orders survival eras by year and finds the 50% crossing', () => {
    const eras = parseSurvival([
      { era: '2022', age: '0', survivingPct: '100' },
      { era: '2022', age: '80', survivingPct: '60' },
      { era: '2022', age: '90', survivingPct: '40' },
      { era: '1851', age: '0', survivingPct: '100' },
      { era: '1851', age: '40', survivingPct: '50' },
    ]);
    expect(eras.map((e) => e.era)).toEqual(['1851', '2022']);
    expect(medianAge(eras[1].points)).toBeCloseTo(85);
  });
});

describe('breakthroughs', () => {
  it('jitter is deterministic and cumulative counts step per tier', () => {
    expect(hash01('x')).toBe(hash01('x'));
    const bs = parseBreakthroughs([
      { id: 'a', date: '2020-01-01', title: 'A', domain: 'math', significance: 1, verification: 'claimed', url: 'u' },
      { id: 'b', date: '2021-01-01', title: 'B', domain: 'science', significance: 4, verification: 'peer-reviewed', url: 'u' },
    ]);
    expect(cumulativeAtLeast(bs, 1, Date.UTC(2022, 0, 1)).map((p) => p[1])).toEqual([1, 2, 2]);
    expect(cumulativeAtLeast(bs, 4, Date.UTC(2022, 0, 1)).map((p) => p[1])).toEqual([1, 1]);
  });
});
