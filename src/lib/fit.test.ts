import { describe, expect, it } from 'vitest';
import {
  bootstrapFits,
  expFit,
  expWithDoubling,
  fitPoints,
  frontier,
  linearFit,
  logisticFit,
  mulberry32,
  predictionBand,
  quantile,
  quantiles,
  solveForX,
  timeToTarget,
  type Pt,
} from './fit.ts';

const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  for (let x = a; x <= b + 1e-9; x += step) out.push(+x.toFixed(6));
  return out;
};

// Synthetic truths (x in fractional years, as the app uses).
const DOUBLING = 0.35; // years ≈ 4.2 months
const expTrue = (x: number) => 5 * 2 ** ((x - 2020) / DOUBLING);
const K = 1.4;
const MID = 2025.5;
const logTrue = (x: number) => 100 / (1 + Math.exp(-K * (x - MID)));
const linTrue = (x: number) => 12 * (x - 2023) + 110;

const xsExp = range(2020, 2026, 0.25);
const xsLog = range(2023, 2028, 0.25);
const ptsExp: Pt[] = xsExp.map((x) => ({ x, y: expTrue(x) }));
const ptsLog: Pt[] = xsLog.map((x) => ({ x, y: logTrue(x) }));
const ptsLin: Pt[] = range(2023, 2026.5, 0.5).map((x) => ({ x, y: linTrue(x) }));

describe('linearFit', () => {
  it('recovers slope and intercept exactly on noise-free data', () => {
    const f = linearFit(
      ptsLin.map((p) => p.x),
      ptsLin.map((p) => p.y),
    )!;
    expect(f.slope).toBeCloseTo(12, 9);
    expect(f.predict(2030)).toBeCloseTo(linTrue(2030), 6);
    expect(f.r2).toBeCloseTo(1, 12);
  });
});

describe('expFit', () => {
  it('recovers a known doubling time from synthetic data', () => {
    const f = expFit(
      ptsExp.map((p) => p.x),
      ptsExp.map((p) => p.y),
    )!;
    expect(f.doublingTime).toBeCloseTo(DOUBLING, 9);
    expect(f.rate).toBeCloseTo(Math.LN2 / DOUBLING, 9);
    expect(f.predict(2027)).toBeCloseTo(expTrue(2027), 3);
  });

  it('recovers doubling time within tolerance under multiplicative noise', () => {
    const rnd = mulberry32(7);
    const noisy = ptsExp.map((p) => ({ x: p.x, y: p.y * Math.exp((rnd() - 0.5) * 0.3) }));
    const f = fitPoints(noisy, 'exponential')!;
    expect(f.kind).toBe('exponential');
    if (f.kind === 'exponential') expect(Math.abs(f.doublingTime - DOUBLING) / DOUBLING).toBeLessThan(0.05);
  });

  it('drops non-positive values it cannot log', () => {
    const f = expFit([2020, 2021, 2022, 2023], [0, 2, 4, 8])!;
    expect(f.n).toBe(3);
    expect(f.doublingTime).toBeCloseTo(1, 9);
  });

  it('reports a decline factor for falling series (cost curves)', () => {
    const xs = [2024, 2024.5, 2025, 2025.5, 2026];
    const f = expFit(
      xs,
      xs.map((x) => 100 / 13 ** (x - 2024)),
    )!;
    expect(1 / f.factorPerUnit).toBeCloseTo(13, 6);
    expect(f.doublingTime).toBeLessThan(0);
  });
});

describe('expWithDoubling', () => {
  it('passes through the anchor with the requested doubling time', () => {
    const f = expWithDoubling(2026, 400, 7 / 12)!;
    expect(f.predict(2026)).toBeCloseTo(400, 9);
    expect(f.predict(2026 + 7 / 12)).toBeCloseTo(800, 6);
    expect(expWithDoubling(2026, 0, 0.5)).toBeNull();
    expect(expWithDoubling(2026, 10, 0)).toBeNull();
  });
});

describe('logisticFit', () => {
  it('recovers the midpoint and slope with a known ceiling', () => {
    const f = logisticFit(
      ptsLog.map((p) => p.x),
      ptsLog.map((p) => p.y),
      100,
    )!;
    expect(f.midpoint).toBeCloseTo(MID, 9);
    expect(f.slope).toBeCloseTo(K, 9);
    expect(f.predict(MID)).toBeCloseTo(50, 9);
  });

  it('clamps saturated values instead of producing infinities', () => {
    const f = logisticFit([2020, 2021, 2022, 2023], [0, 10, 60, 100], 100)!;
    expect(Number.isFinite(f.midpoint)).toBe(true);
    expect(Number.isFinite(f.slope)).toBe(true);
    expect(f.slope).toBeGreaterThan(0);
  });

  it('returns null without a usable ceiling', () => {
    expect(fitPoints(ptsLog, 'logistic')).toBeNull();
    expect(logisticFit([1, 2, 3], [1, 2, 3], 0)).toBeNull();
  });
});

describe('solveForX', () => {
  const fits = [fitPoints(ptsLin, 'linear')!, fitPoints(ptsExp, 'exponential')!, fitPoints(ptsLog, 'logistic', { ceiling: 100 })!];
  it.each(fits.map((f) => [f.kind, f] as const))('inverts predict (%s)', (_k, f) => {
    for (const x of [2021.3, 2024, 2025.75, 2029.1]) {
      const y = f.predict(x);
      if (f.kind === 'logistic' && (y <= 0 || y >= 100)) continue;
      expect(f.solveForX(y)!).toBeCloseTo(x, 6);
      expect(solveForX(f, y)!).toBeCloseTo(x, 6);
    }
  });

  it('returns null where no x exists', () => {
    const exp = fitPoints(ptsExp, 'exponential')!;
    expect(exp.solveForX(0)).toBeNull();
    expect(exp.solveForX(-5)).toBeNull();
    const log = fitPoints(ptsLog, 'logistic', { ceiling: 100 })!;
    expect(log.solveForX(100)).toBeNull();
    expect(log.solveForX(120)).toBeNull();
  });
});

describe('bootstrapFits', () => {
  it('is deterministic for a given seed', () => {
    const noisy = ptsExp.map((p, i) => ({ x: p.x, y: p.y * (1 + ((i * 37) % 11) / 40) }));
    const a = bootstrapFits(noisy, 'exponential', 50, 123).map((f) => f.predict(2027));
    const b = bootstrapFits(noisy, 'exponential', 50, 123).map((f) => f.predict(2027));
    const c = bootstrapFits(noisy, 'exponential', 50, 124).map((f) => f.predict(2027));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('80% intervals contain the true value on noise-free data', () => {
    for (const [pts, kind, truth, opts] of [
      [ptsExp, 'exponential', expTrue, {}],
      [ptsLog, 'logistic', logTrue, { ceiling: 100 }],
      [ptsLin, 'linear', linTrue, {}],
    ] as const) {
      const boots = bootstrapFits([...pts], kind, 300, 42, opts);
      expect(boots.length).toBeGreaterThan(250);
      const band = predictionBand(boots, [2024, 2027, 2030]);
      for (const b of band) {
        const t = truth(b.x);
        const tol = Math.abs(t) * 1e-6;
        expect(b.lo).toBeLessThanOrEqual(t + tol);
        expect(b.hi).toBeGreaterThanOrEqual(t - tol);
      }
    }
  });

  it('time-to-target interval contains the true crossing on noise-free data', () => {
    const fit = fitPoints(ptsExp, 'exponential')!;
    const boots = bootstrapFits(ptsExp, 'exponential', 300, 9);
    const target = expTrue(2027.4);
    const r = timeToTarget(fit, boots, target, { observedBest: expTrue(2026) });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.x).toBeCloseTo(2027.4, 6);
      expect(r.lo).toBeLessThanOrEqual(2027.4 + 1e-6);
      expect(r.hi).toBeGreaterThanOrEqual(2027.4 - 1e-6);
      expect(r.neverShare).toBe(0);
    }
  });

  it('returns nothing for fewer than 3 points', () => {
    expect(bootstrapFits(ptsExp.slice(0, 2), 'exponential', 100, 1)).toEqual([]);
  });
});

describe('edge cases', () => {
  it('fewer than 3 points → null for every model', () => {
    const two = ptsExp.slice(0, 2);
    expect(fitPoints(two, 'linear')).toBeNull();
    expect(fitPoints(two, 'exponential')).toBeNull();
    expect(fitPoints(two, 'logistic', { ceiling: 100 })).toBeNull();
    expect(fitPoints([], 'linear')).toBeNull();
  });

  it('identical x values → null (slope undefined)', () => {
    expect(linearFit([2025, 2025, 2025], [1, 2, 3])).toBeNull();
  });

  it('non-finite values are ignored', () => {
    const f = linearFit([2020, 2021, NaN, 2022, 2023], [1, 2, 5, 3, Infinity]);
    expect(f?.n).toBe(3);
  });

  it('target already reached', () => {
    const fit = fitPoints(ptsExp, 'exponential')!;
    expect(timeToTarget(fit, [], 50, { observedBest: 60 })).toEqual({ status: 'reached' });
    // lower-is-better series (e.g. cost): reached when observed ≤ target
    expect(timeToTarget(fit, [], 50, { observedBest: 40, higherIsBetter: false })).toEqual({ status: 'reached' });
  });

  it('target unreachable at or above a logistic ceiling', () => {
    const fit = fitPoints(ptsLog, 'logistic', { ceiling: 100 })!;
    expect(timeToTarget(fit, [], 100, { observedBest: 90 })).toEqual({ status: 'unreachable', reason: 'ceiling' });
    expect(timeToTarget(fit, [], 130, { observedBest: 90 })).toEqual({ status: 'unreachable', reason: 'ceiling' });
  });

  it('target unreachable on a declining trend', () => {
    const pts = [2020, 2021, 2022, 2023].map((x) => ({ x, y: 100 - 10 * (x - 2020) }));
    const fit = fitPoints(pts, 'linear')!;
    expect(timeToTarget(fit, [], 200, { observedBest: 100 })).toEqual({ status: 'unreachable', reason: 'declining' });
  });

  it('bootstrap fits that never arrive push the upper bound to Infinity', () => {
    const fit = fitPoints(ptsLin, 'linear')!;
    const flat = linearFit([1, 2, 3], [5, 4, 3])!; // declining → never reaches
    const r = timeToTarget(fit, [fit, fit, flat, flat, flat], 200, { observedBest: 150 });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.hi).toBe(Infinity);
      expect(r.neverShare).toBeCloseTo(0.6, 9);
    }
  });
});

describe('quantile helpers', () => {
  it('interpolates linearly', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([0, 10], 0.25)).toBe(2.5);
    expect(quantile([7], 0.9)).toBe(7);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });
  it('sorts, drops NaN and tolerates Infinity', () => {
    expect(quantiles([5, NaN, 1, 3], [0, 1])).toEqual([1, 5]);
    expect(quantiles([1, 2, Infinity, Infinity], [0.9])[0]).toBe(Infinity);
  });
});

describe('frontier', () => {
  it('keeps only best-so-far points in x order', () => {
    const pts = [
      { x: 3, y: 5 },
      { x: 1, y: 2 },
      { x: 2, y: 1 },
      { x: 4, y: 5 },
      { x: 5, y: 9 },
    ];
    expect(frontier(pts, (p) => p.x, (p) => p.y)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 5 },
      { x: 5, y: 9 },
    ]);
    expect(frontier(pts, (p) => p.x, (p) => p.y, false).map((p) => p.y)).toEqual([2, 1]);
  });
});
