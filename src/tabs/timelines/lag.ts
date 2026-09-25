// Pure lag math for "how far is reality behind AI 2027?". No React, no DOM.
//
// For each proxy: lag = realityDate − scenarioDate, in months (+ = reality is behind the
// scenario, − = ahead). A proxy that has not been reached uses its projectedDate when that
// projection is still in the future; otherwise (now − scenarioDate) is only a LOWER bound.
// The headline is the weight-weighted median of the per-proxy lags.

/** Mean Gregorian month, in days. */
export const DAYS_PER_MONTH = 365.2425 / 12;
const MS_PER_MONTH = DAYS_PER_MONTH * 864e5;

export type LagKind = 'reached' | 'projected' | 'lower-bound' | 'excluded';

export interface LagProxyInput {
  id: string;
  scenarioDate: string;
  status: 'reached' | 'not-yet';
  realityDate?: string | null;
  projectedDate?: string | null;
  weight?: number | null;
}

export interface ProxyLag {
  id: string;
  kind: LagKind;
  /** Signed months; null when excluded. For 'lower-bound' the true lag is ≥ this. */
  months: number | null;
  /** True when `months` is a lower bound (the event has not happened yet). */
  atLeast: boolean;
  /** Where reality sits on the time axis: the reality date, the projected date, or now. */
  endDate: string | null;
  weight: number;
  /** Why a proxy is excluded, or a caveat on how it was computed. */
  reason?: string;
}

export interface LagSummary {
  /** Weighted-median lag in months, or null when no proxy can be counted. */
  months: number | null;
  /** True when lower-bound proxies could still push the median up. */
  atLeast: boolean;
  lags: ProxyLag[];
  total: number;
  counted: number;
  reached: number;
  projected: number;
  lowerBound: number;
  excluded: number;
}

const parse = (d: string | null | undefined): number | null => {
  if (!d) return null;
  const t = Date.parse(d.length === 7 ? `${d}-01` : d.slice(0, 10));
  return Number.isFinite(t) ? t : null;
};

/** Signed months from `from` to `to` (positive when `to` is later). */
export function monthsBetween(from: string, to: string): number {
  const a = parse(from);
  const b = parse(to);
  if (a == null || b == null) return NaN;
  return (b - a) / MS_PER_MONTH;
}

export function proxyLag(p: LagProxyInput, now: string): ProxyLag {
  const weight = typeof p.weight === 'number' && Number.isFinite(p.weight) ? p.weight : 1;
  const base = { id: p.id, weight };
  const scen = parse(p.scenarioDate);
  const nowT = parse(now);
  if (scen == null || nowT == null) return { ...base, kind: 'excluded', months: null, atLeast: false, endDate: null, reason: 'invalid date' };
  if (weight <= 0) return { ...base, kind: 'excluded', months: null, atLeast: false, endDate: null, reason: 'zero weight' };

  if (p.status === 'reached') {
    if (parse(p.realityDate) == null) return { ...base, kind: 'excluded', months: null, atLeast: false, endDate: null, reason: 'reached but no reality date' };
    return { ...base, kind: 'reached', months: monthsBetween(p.scenarioDate, p.realityDate!), atLeast: false, endDate: p.realityDate!.slice(0, 10) };
  }

  const proj = parse(p.projectedDate);
  if (proj != null && proj >= nowT) {
    return { ...base, kind: 'projected', months: monthsBetween(p.scenarioDate, p.projectedDate!), atLeast: false, endDate: p.projectedDate!.slice(0, 10) };
  }
  if (scen > nowT) {
    // Not reached, but the scenario date is still ahead of us: nothing is known yet.
    return { ...base, kind: 'excluded', months: null, atLeast: false, endDate: null, reason: 'scenario date still in the future' };
  }
  return {
    ...base,
    kind: 'lower-bound',
    months: monthsBetween(p.scenarioDate, now),
    atLeast: true,
    endDate: now.slice(0, 10),
    reason: proj != null ? 'projected date has passed without the event' : undefined,
  };
}

/**
 * Weighted median: sort by value, walk the cumulative weight, and return the first value
 * whose cumulative weight reaches half the total. An exact half split averages the two
 * neighbours, so equal weights reproduce the ordinary median.
 */
export function weightedMedian(items: { value: number; weight: number }[]): number | null {
  const xs = items.filter((i) => Number.isFinite(i.value) && Number.isFinite(i.weight) && i.weight > 0).sort((a, b) => a.value - b.value);
  const total = xs.reduce((s, i) => s + i.weight, 0);
  if (!xs.length || total <= 0) return null;
  const half = total / 2;
  const eps = 1e-9 * total;
  let cum = 0;
  for (let k = 0; k < xs.length; k++) {
    cum += xs[k].weight;
    if (cum >= half - eps) {
      if (Math.abs(cum - half) <= eps && k + 1 < xs.length) return (xs[k].value + xs[k + 1].value) / 2;
      return xs[k].value;
    }
  }
  return xs[xs.length - 1].value;
}

export function summarizeLag(proxies: LagProxyInput[], now: string): LagSummary {
  const lags = proxies.map((p) => proxyLag(p, now));
  const counted = lags.filter((l) => l.kind !== 'excluded' && l.months != null);
  const items = counted.map((l) => ({ value: l.months!, weight: l.weight }));
  const months = weightedMedian(items);
  // The headline is itself a lower bound if raising the lower-bound proxies could move it.
  let atLeast = false;
  if (months != null && counted.some((l) => l.atLeast)) {
    const raised = weightedMedian(counted.map((l) => ({ value: l.atLeast ? l.months! + 1e6 : l.months!, weight: l.weight })));
    atLeast = raised != null && raised > months + 1e-9;
  }
  return {
    months,
    atLeast,
    lags,
    total: lags.length,
    counted: counted.length,
    reached: lags.filter((l) => l.kind === 'reached').length,
    projected: lags.filter((l) => l.kind === 'projected').length,
    lowerBound: lags.filter((l) => l.kind === 'lower-bound').length,
    excluded: lags.filter((l) => l.kind === 'excluded').length,
  };
}

/** "+7.3 mo" / "−2.0 mo" / "≥ +1.8 mo" with a real minus sign. */
export function fmtLag(months: number | null, atLeast = false, digits = 1): string {
  if (months == null || !Number.isFinite(months)) return '—';
  const r = Number(months.toFixed(digits));
  const sign = r > 0 ? '+' : r < 0 ? '−' : '±';
  return `${atLeast ? '≥ ' : ''}${sign}${Math.abs(r).toFixed(digits)} mo`;
}
