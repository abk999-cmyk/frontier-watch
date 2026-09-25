import type { Benchmark, Effort, ScoreRecord } from '../../shared/types.ts';

export type ScoreIndex = Map<string, Map<string, ScoreRecord[]>>;

export function indexScores(records: ScoreRecord[]): ScoreIndex {
  const idx: ScoreIndex = new Map();
  for (const r of records) {
    let m = idx.get(r.m);
    if (!m) idx.set(r.m, (m = new Map()));
    const list = m.get(r.b);
    if (list) list.push(r);
    else m.set(r.b, [r]);
  }
  return idx;
}

export interface CellFilter {
  /** 'max' = highest across effort levels (default); otherwise only that effort level. */
  effort?: 'max' | Effort;
  prov?: 'any' | 'independent' | 'lab';
  /** undefined = any; true/false = only with/without tools */
  tools?: boolean;
}

/** Pick the record a table cell shows: best value under the filter; ties prefer independent runs. */
export function bestRecord(recs: ScoreRecord[] | undefined, bench: Benchmark, f: CellFilter = {}): ScoreRecord | undefined {
  if (!recs?.length) return undefined;
  let best: ScoreRecord | undefined;
  for (const r of recs) {
    if (f.prov && f.prov !== 'any' && r.prov !== f.prov) continue;
    if (f.tools !== undefined && (r.tools ?? false) !== f.tools) continue;
    if (f.effort && f.effort !== 'max' && r.effort && r.effort !== f.effort) continue;
    if (!best) {
      best = r;
      continue;
    }
    const better = bench.higherIsBetter ? r.v > best.v : r.v < best.v;
    if (better || (r.v === best.v && r.prov === 'independent' && best.prov !== 'independent')) best = r;
  }
  return best;
}

/** Relative position of a value inside the column's observed range (0..1) for cell shading. */
export function normalise(v: number, lo: number, hi: number, higherIsBetter: boolean) {
  if (hi <= lo) return 1;
  const t = (v - lo) / (hi - lo);
  return higherIsBetter ? t : 1 - t;
}
