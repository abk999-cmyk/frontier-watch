import { describe, expect, it } from 'vitest';
import { DAYS_PER_MONTH, fmtLag, monthsBetween, proxyLag, summarizeLag, weightedMedian } from './lag.ts';

const NOW = '2026-09-24';

describe('monthsBetween', () => {
  it('is signed and uses the mean Gregorian month', () => {
    expect(monthsBetween('2025-01-01', '2026-01-01')).toBeCloseTo(365 / DAYS_PER_MONTH, 6);
    expect(monthsBetween('2026-01-01', '2025-01-01')).toBeCloseTo(-365 / DAYS_PER_MONTH, 6);
    expect(Number.isNaN(monthsBetween('nope', '2025-01-01'))).toBe(true);
  });
});

describe('proxyLag', () => {
  it('reached: lag = realityDate − scenarioDate (behind is positive)', () => {
    const l = proxyLag({ id: 'flop', scenarioDate: '2025-12-01', realityDate: '2026-09-03', status: 'reached' }, NOW);
    expect(l.kind).toBe('reached');
    expect(l.atLeast).toBe(false);
    expect(l.endDate).toBe('2026-09-03');
    expect(l.months).toBeCloseTo(9.07, 1);
  });

  it('reached ahead of the scenario gives a negative lag', () => {
    const l = proxyLag({ id: 'rev', scenarioDate: '2027-02-19', realityDate: '2026-07-31', status: 'reached' }, NOW);
    expect(l.months!).toBeLessThan(0);
    expect(l.months).toBeCloseTo(-6.7, 1);
  });

  it('not-yet with a future projection uses the projected date', () => {
    const l = proxyLag({ id: 'sc', scenarioDate: '2027-03-01', status: 'not-yet', projectedDate: '2027-08-01' }, NOW);
    expect(l.kind).toBe('projected');
    expect(l.atLeast).toBe(false);
    expect(l.endDate).toBe('2027-08-01');
    expect(l.months).toBeCloseTo(5.0, 1);
  });

  it('not-yet without a projection is a lower bound (now − scenarioDate), flagged', () => {
    const l = proxyLag({ id: 'china', scenarioDate: '2026-08-01', status: 'not-yet', projectedDate: null }, NOW);
    expect(l.kind).toBe('lower-bound');
    expect(l.atLeast).toBe(true);
    expect(l.endDate).toBe(NOW);
    expect(l.months).toBeCloseTo(1.8, 1);
    expect(fmtLag(l.months, l.atLeast)).toBe('≥ +1.8 mo');
  });

  it('a projection that has already passed falls back to the lower bound', () => {
    const l = proxyLag({ id: 'stale', scenarioDate: '2026-01-01', status: 'not-yet', projectedDate: '2026-06-01' }, NOW);
    expect(l.kind).toBe('lower-bound');
    expect(l.atLeast).toBe(true);
    expect(l.reason).toMatch(/passed/);
  });

  it('excludes unreached proxies whose scenario date is still ahead, and bad rows', () => {
    expect(proxyLag({ id: 'f', scenarioDate: '2027-06-01', status: 'not-yet' }, NOW).kind).toBe('excluded');
    expect(proxyLag({ id: 'r', scenarioDate: '2026-01-01', status: 'reached' }, NOW).kind).toBe('excluded');
    expect(proxyLag({ id: 'w', scenarioDate: '2026-01-01', status: 'reached', realityDate: '2026-02-01', weight: 0 }, NOW).kind).toBe('excluded');
  });
});

describe('weightedMedian', () => {
  it('equal weights reproduce the ordinary median (odd and even)', () => {
    expect(weightedMedian([3, 1, 2].map((value) => ({ value, weight: 1 })))).toBe(2);
    expect(weightedMedian([4, 1, 3, 2].map((value) => ({ value, weight: 1 })))).toBe(2.5);
  });

  it('heavier items pull the median toward them', () => {
    expect(weightedMedian([{ value: 0, weight: 1 }, { value: 10, weight: 3 }])).toBe(10);
    expect(weightedMedian([{ value: -5, weight: 0.5 }, { value: 1, weight: 1 }, { value: 8, weight: 0.5 }])).toBe(1);
  });

  it('empty or weightless input gives null', () => {
    expect(weightedMedian([])).toBeNull();
    expect(weightedMedian([{ value: 3, weight: 0 }])).toBeNull();
  });
});

describe('summarizeLag', () => {
  it('empty input yields an honest null headline', () => {
    const s = summarizeLag([], NOW);
    expect(s.months).toBeNull();
    expect(s.atLeast).toBe(false);
    expect(s.total).toBe(0);
    expect(s.counted).toBe(0);
  });

  it('combines reached, projected and lower-bound proxies by weighted median', () => {
    const s = summarizeLag(
      [
        { id: 'a', scenarioDate: '2026-01-01', realityDate: '2026-03-01', status: 'reached', weight: 1 }, // ≈ +1.9
        { id: 'b', scenarioDate: '2026-03-01', realityDate: '2026-01-01', status: 'reached', weight: 1 }, // ≈ −1.9
        { id: 'c', scenarioDate: '2027-03-01', status: 'not-yet', projectedDate: '2027-08-01', weight: 0.5 }, // ≈ +5.0
        { id: 'd', scenarioDate: '2026-08-01', status: 'not-yet', weight: 0.5 }, // ≥ +1.8
        { id: 'e', scenarioDate: '2027-06-01', status: 'not-yet', weight: 1 }, // excluded
      ],
      NOW,
    );
    expect(s.total).toBe(5);
    expect(s.counted).toBe(4);
    expect(s.reached).toBe(2);
    expect(s.projected).toBe(1);
    expect(s.lowerBound).toBe(1);
    expect(s.excluded).toBe(1);
    // total weight 3, half 1.5: sorted −1.9 (1), +1.8 (0.5) → cum 1.5 = half → average with +1.9.
    expect(s.months).toBeCloseTo((monthsBetween('2026-08-01', NOW) + monthsBetween('2026-01-01', '2026-03-01')) / 2, 6);
    // The lower-bound proxy sits at the median, so the headline is itself a lower bound.
    expect(s.atLeast).toBe(true);
  });

  it('a lower bound above the median does not make the headline a lower bound', () => {
    const s = summarizeLag(
      [
        { id: 'a', scenarioDate: '2026-01-01', realityDate: '2026-02-01', status: 'reached' },
        { id: 'b', scenarioDate: '2026-01-01', realityDate: '2026-03-01', status: 'reached' },
        { id: 'c', scenarioDate: '2026-01-01', realityDate: '2026-04-01', status: 'reached' },
        { id: 'd', scenarioDate: '2025-06-01', status: 'not-yet' }, // ≥ +15.8, above the median
      ],
      NOW,
    );
    expect(s.atLeast).toBe(false);
    expect(s.months).toBeCloseTo((monthsBetween('2026-01-01', '2026-03-01') + monthsBetween('2026-01-01', '2026-04-01')) / 2, 6);
  });
});

describe('fmtLag', () => {
  it('formats sign, bound and missing values', () => {
    expect(fmtLag(7.26)).toBe('+7.3 mo');
    expect(fmtLag(-2)).toBe('−2.0 mo');
    expect(fmtLag(0.01)).toBe('±0.0 mo');
    expect(fmtLag(null)).toBe('—');
  });
});
