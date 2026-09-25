import type { Benchmark, Unit } from '../../shared/types.ts';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const toTime = (d: string) => Date.parse(d.length === 7 ? `${d}-01` : d);
export const monthYear = (d: string) => {
  const [y, m] = d.split('-');
  return `${MON[Number(m) - 1]} ${y}`;
};
export const shortDate = (d: string) => {
  const [y, m, day] = d.split('-');
  return `${MON[Number(m) - 1]} ${Number(day)}, ${y}`;
};
export const yearFrac = (d: string | number) => {
  const t = typeof d === 'number' ? d : toTime(d);
  const date = new Date(t);
  const y = date.getUTCFullYear();
  return y + (t - Date.UTC(y, 0, 1)) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1));
};
export const fromYearFrac = (yf: number) => {
  const y = Math.floor(yf);
  return Date.UTC(y, 0, 1) + (yf - y) * (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1));
};
export const isoFromTime = (t: number) => new Date(t).toISOString().slice(0, 10);

export function fmtMinutes(min: number): string {
  if (min < 1) return `${Math.round(min * 60)}s`;
  if (min < 60) return `${min < 10 ? min.toFixed(1) : Math.round(min)}m`;
  const h = min / 60;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
  const d = h / 24;
  if (d < 60) return `${d.toFixed(d < 10 ? 1 : 0)}d`;
  return `${(d / 30.4).toFixed(1)}mo`;
}

export function fmtUsd(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}k`;
  if (a >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(3)}`;
}

export function fmtValue(v: number, unit: Unit, compact = false): string {
  switch (unit) {
    case 'pct':
      return compact ? (v >= 99.95 ? '100' : v.toFixed(v < 10 ? 1 : 1)) : `${v.toFixed(1)}%`;
    case 'minutes':
      return fmtMinutes(v);
    case 'usd':
      return fmtUsd(v);
    case 'points':
      return `${v % 1 === 0 ? v : v.toFixed(1)}`;
    case 'index':
      return v.toFixed(1);
  }
}

export const fmtBench = (v: number, b: Benchmark, compact = false) => fmtValue(v, b.unit, compact);

export function fmtFlop(f: number): string {
  const e = Math.floor(Math.log10(f));
  const m = f / 10 ** e;
  return `${m.toFixed(m < 10 && m % 1 !== 0 ? 1 : 0)}e${e}`;
}

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
