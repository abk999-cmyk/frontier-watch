/**
 * Trend-fitting math for the Charts Lab. Pure functions, no DOM, fully deterministic.
 *
 * Every fit works in a transformed space where the model is a straight line, then uses OLS:
 *   linear       y            = a + b·x
 *   exponential  ln y         = a + r·x          (log-linear; doubling time = ln2 / r)
 *   logistic     logit(y / C) = k·(x − x₀)       (known ceiling C; y clamped to 0.5%…99.5% of C)
 *
 * x is whatever unit the caller uses (the app uses fractional years), so rates and doubling
 * times come back in that unit.
 */

export type FitKind = 'linear' | 'exponential' | 'logistic';

export interface Pt {
  x: number;
  y: number;
}

interface FitBase {
  kind: FitKind;
  /** Number of points the fit used. */
  n: number;
  /** Coefficient of determination in the transformed (linearised) space. */
  r2: number;
  predict: (x: number) => number;
  /** Inverse of predict: the x at which the fitted curve reaches `target`, or null if it never does. */
  solveForX: (target: number) => number | null;
}

export interface LinearFit extends FitBase {
  kind: 'linear';
  slope: number;
  intercept: number;
}

export interface ExpFit extends FitBase {
  kind: 'exponential';
  /** Continuous growth rate per x-unit (ln-space slope). Negative = decline. */
  rate: number;
  /** ln2 / rate, in x-units. Negative means a halving time; ±Infinity when flat. */
  doublingTime: number;
  /** Multiplicative change per x-unit, e^rate (e.g. 0.08 = falls 12.5× per unit). */
  factorPerUnit: number;
}

export interface LogisticFit extends FitBase {
  kind: 'logistic';
  ceiling: number;
  /** x where the curve crosses C/2. */
  midpoint: number;
  /** Logistic steepness k (per x-unit). */
  slope: number;
}

export type Fit = LinearFit | ExpFit | LogisticFit;

export const MIN_FIT_POINTS = 3;
const LOGIT_CLAMP = 0.005;

// ── OLS core ───────────────────────────────────────────────────────────────

interface Ols {
  slope: number;
  /** Anchor (mean x, mean y) keeps predictions numerically stable for x ≈ 2025. */
  mx: number;
  my: number;
  r2: number;
}

function ols(xs: number[], ys: number[]): Ols | null {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  // Need at least two distinct x values.
  if (!(sxx > 1e-12 * Math.max(1, mx * mx))) return null;
  const slope = sxy / sxx;
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 1;
  return { slope, mx, my, r2 };
}

const finitePairs = (xs: number[], ys: number[], keep: (y: number) => boolean = () => true) => {
  const fx: number[] = [];
  const fy: number[] = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i]) && keep(ys[i])) {
      fx.push(xs[i]);
      fy.push(ys[i]);
    }
  }
  return [fx, fy] as const;
};

// ── Fits ───────────────────────────────────────────────────────────────────

export function linearFit(xs: number[], ys: number[]): LinearFit | null {
  const [fx, fy] = finitePairs(xs, ys);
  if (fx.length < MIN_FIT_POINTS) return null;
  const o = ols(fx, fy);
  if (!o) return null;
  const { slope, mx, my } = o;
  return {
    kind: 'linear',
    n: fx.length,
    r2: o.r2,
    slope,
    intercept: my - slope * mx,
    predict: (x) => my + slope * (x - mx),
    solveForX: (target) => (slope === 0 || !Number.isFinite(target) ? null : mx + (target - my) / slope),
  };
}

function makeExp(rate: number, ax: number, lnAy: number, n: number, r2: number): ExpFit {
  return {
    kind: 'exponential',
    n,
    r2,
    rate,
    doublingTime: rate === 0 ? Infinity : Math.LN2 / rate,
    factorPerUnit: Math.exp(rate),
    predict: (x) => Math.exp(lnAy + rate * (x - ax)),
    solveForX: (target) => (!(target > 0) || rate === 0 || !Number.isFinite(target) ? null : ax + (Math.log(target) - lnAy) / rate),
  };
}

/** Log-linear (exponential) fit. Non-positive y values cannot be logged and are dropped. */
export function expFit(xs: number[], ys: number[]): ExpFit | null {
  const [fx, fy] = finitePairs(xs, ys, (y) => y > 0);
  if (fx.length < MIN_FIT_POINTS) return null;
  const o = ols(
    fx,
    fy.map((y) => Math.log(y)),
  );
  if (!o) return null;
  return makeExp(o.slope, o.mx, o.my, fx.length, o.r2);
}

/**
 * Exponential curve with a fixed doubling time that passes through (anchorX, anchorY).
 * Powers the "what if progress is faster/slower" override.
 */
export function expWithDoubling(anchorX: number, anchorY: number, doublingTime: number): ExpFit | null {
  if (!(anchorY > 0) || !Number.isFinite(doublingTime) || doublingTime === 0) return null;
  return makeExp(Math.LN2 / doublingTime, anchorX, Math.log(anchorY), 0, NaN);
}

const logit = (p: number) => Math.log(p / (1 - p));

/** Logistic fit with a known ceiling C via the logit transform + OLS. */
export function logisticFit(xs: number[], ys: number[], ceiling: number): LogisticFit | null {
  if (!(ceiling > 0) || !Number.isFinite(ceiling)) return null;
  const [fx, fy] = finitePairs(xs, ys);
  if (fx.length < MIN_FIT_POINTS) return null;
  const z = fy.map((y) => logit(Math.min(1 - LOGIT_CLAMP, Math.max(LOGIT_CLAMP, y / ceiling))));
  const o = ols(fx, z);
  if (!o || o.slope === 0) return null;
  const k = o.slope;
  const midpoint = o.mx - o.my / k;
  return {
    kind: 'logistic',
    n: fx.length,
    r2: o.r2,
    ceiling,
    midpoint,
    slope: k,
    predict: (x) => ceiling / (1 + Math.exp(-k * (x - midpoint))),
    solveForX: (target) => {
      if (!Number.isFinite(target) || target <= 0 || target >= ceiling) return null;
      return midpoint + logit(target / ceiling) / k;
    },
  };
}

export interface FitOptions {
  /** Required for logistic. */
  ceiling?: number | null;
}

export function fitPoints(points: Pt[], kind: FitKind, opts: FitOptions = {}): Fit | null {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  switch (kind) {
    case 'linear':
      return linearFit(xs, ys);
    case 'exponential':
      return expFit(xs, ys);
    case 'logistic':
      return opts.ceiling != null ? logisticFit(xs, ys, opts.ceiling) : null;
  }
}

/** Standalone form of `fit.solveForX(target)`. */
export const solveForX = (fit: Fit, target: number) => fit.solveForX(target);

// ── Bootstrap ──────────────────────────────────────────────────────────────

/** Mulberry32: tiny, fast, seedable PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Case-resampling bootstrap: draw points with replacement `n` times and refit each sample.
 * Samples that cannot be fitted (e.g. all the same x) are skipped, so the result can be shorter than n.
 * The same seed always gives the same fits.
 */
export function bootstrapFits(points: Pt[], kind: FitKind, n = 300, seed = 1, opts: FitOptions = {}): Fit[] {
  if (points.length < MIN_FIT_POINTS) return [];
  const rnd = mulberry32(seed);
  const out: Fit[] = [];
  const m = points.length;
  for (let i = 0; i < n; i++) {
    const sample: Pt[] = new Array(m);
    for (let j = 0; j < m; j++) sample[j] = points[Math.floor(rnd() * m)];
    const f = fitPoints(sample, kind, opts);
    if (f) out.push(f);
  }
  return out;
}

// ── Quantiles & bands ──────────────────────────────────────────────────────

/** Linear-interpolated quantile of an ascending-sorted array. ±Infinity values are allowed. */
export function quantile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  if (n === 1) return sorted[0];
  const pos = Math.min(1, Math.max(0, q)) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const a = sorted[lo];
  const b = sorted[hi];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return pos - lo < 0.5 ? a : b;
  return a + (b - a) * (pos - lo);
}

/** Quantiles of an unsorted list (NaN dropped). */
export function quantiles(values: number[], qs: number[]): number[] {
  const s = values.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  return qs.map((q) => quantile(s, q));
}

export interface BandPoint {
  x: number;
  lo: number;
  mid: number;
  hi: number;
}

/** Pointwise prediction band across bootstrap fits (default 80%: 10th–90th percentile). */
export function predictionBand(fits: Fit[], xs: number[], lo = 0.1, hi = 0.9): BandPoint[] {
  if (!fits.length) return [];
  return xs.map((x) => {
    const [l, m, h] = quantiles(
      fits.map((f) => f.predict(x)),
      [lo, 0.5, hi],
    );
    return { x, lo: l, mid: m, hi: h };
  });
}

// ── Time to target ─────────────────────────────────────────────────────────

export type TargetResult =
  | { status: 'reached' }
  | { status: 'unreachable'; reason: 'ceiling' | 'flat' | 'declining' }
  | { status: 'ok'; x: number; lo: number; hi: number; /** share of bootstrap fits that never reach the target */ neverShare: number };

/**
 * When does the fitted curve reach `target`?
 * - 'reached' if the observed best already meets it. (A fit that crossed the target in the past while
 *   the data has not is returned as 'ok' with an x in the past; the caller words that case.)
 * - 'unreachable' if the curve can never get there (at/above a logistic ceiling, or a flat/declining trend).
 * - otherwise the point estimate plus a bootstrap interval (default 80%). Bootstrap fits that never
 *   reach the target count as +Infinity, so `hi` can be Infinity.
 */
export function timeToTarget(
  fit: Fit,
  boots: Fit[],
  target: number,
  opts: { observedBest?: number | null; higherIsBetter?: boolean; lo?: number; hi?: number } = {},
): TargetResult {
  const hib = opts.higherIsBetter ?? true;
  const lo = opts.lo ?? 0.1;
  const hi = opts.hi ?? 0.9;
  if (opts.observedBest != null && (hib ? opts.observedBest >= target : opts.observedBest <= target)) return { status: 'reached' };
  if (fit.kind === 'logistic' && (target >= fit.ceiling || target <= 0)) return { status: 'unreachable', reason: 'ceiling' };
  const trend = fit.kind === 'linear' ? fit.slope : fit.kind === 'exponential' ? fit.rate : fit.slope;
  if (trend === 0) return { status: 'unreachable', reason: 'flat' };
  if (hib ? trend < 0 : trend > 0) return { status: 'unreachable', reason: 'declining' };
  const x = fit.solveForX(target);
  if (x == null || !Number.isFinite(x)) return { status: 'unreachable', reason: 'flat' };

  // Bootstrap fits whose trend points the wrong way never arrive → +Infinity.
  const xs = boots.map((b) => {
    const t = b.kind === 'exponential' ? b.rate : b.slope;
    if (hib ? t <= 0 : t >= 0) return Infinity;
    const s = b.solveForX(target);
    return s == null || !Number.isFinite(s) ? Infinity : s;
  });
  const never = xs.filter((v) => v === Infinity).length;
  const [l, h] = xs.length ? quantiles(xs, [lo, hi]) : [x, x];
  return { status: 'ok', x, lo: Math.min(l, x), hi: Math.max(h, x), neverShare: xs.length ? never / xs.length : 0 };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Best-so-far frontier (step points) of a series sorted by x. */
export function frontier<T>(items: T[], x: (d: T) => number, y: (d: T) => number, higherIsBetter = true): T[] {
  const sorted = [...items].filter((d) => Number.isFinite(x(d)) && Number.isFinite(y(d))).sort((a, b) => x(a) - x(b) || (higherIsBetter ? y(b) - y(a) : y(a) - y(b)));
  const out: T[] = [];
  for (const d of sorted) {
    const last = out.at(-1);
    if (!last || (higherIsBetter ? y(d) > y(last) : y(d) < y(last))) out.push(d);
  }
  return out;
}
