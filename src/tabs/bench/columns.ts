import { BENCH_GROUP_ORDER, type Benchmark, type BenchGroup, type Model } from '../../../shared/types.ts';
import { bestRecord, type CellFilter, type ScoreIndex } from '../../lib/scores.ts';

export interface Column {
  key: string;
  bench: Benchmark;
  label: string;
  sub?: string;
  group: BenchGroup;
  filter: CellFilter;
}

/** Benchmarks → table columns in Abhinav's order. HLE splits into three provenance/tools columns. */
export function buildColumns(benchmarks: Benchmark[]): Column[] {
  const cols: Column[] = [];
  for (const g of BENCH_GROUP_ORDER) {
    for (const b of benchmarks.filter((x) => x.group === g)) {
      if (b.id === 'hle') {
        cols.push({ key: 'hle:ind', bench: b, label: 'HLE', sub: 'independent', group: g, filter: { prov: 'independent' } });
        cols.push({ key: 'hle:lab', bench: b, label: 'HLE', sub: 'lab · no tools', group: g, filter: { prov: 'lab', tools: false } });
        cols.push({ key: 'hle:labt', bench: b, label: 'HLE', sub: 'lab · tools', group: g, filter: { prov: 'lab', tools: true } });
      } else {
        cols.push({ key: b.id, bench: b, label: b.short, sub: b.version && !b.short.includes(String(b.version)) ? `v${b.version}` : undefined, group: g, filter: {} });
      }
    }
  }
  return cols;
}

export interface CellInfo {
  value: number;
  rec: ReturnType<typeof bestRecord> & object;
  sota: boolean;
  shade: number; // 0..1 within column
  n: number;
}

/**
 * Resolve every visible cell once: best record under the global filters, the
 * column's shading range, and whether the model set a new state of the art
 * (best among all models released on or before it) in that column.
 */
export function resolveCells(models: Model[], cols: Column[], idx: ScoreIndex, global: CellFilter) {
  const byRelease = [...models].sort((a, b) => a.released.localeCompare(b.released));
  const cells = new Map<string, CellInfo>();
  const colHasData = new Map<string, boolean>();
  for (const c of cols) {
    const f: CellFilter = { ...global, ...c.filter, prov: c.filter.prov ?? global.prov };
    let lo = Infinity;
    let hi = -Infinity;
    const vals: [Model, NonNullable<ReturnType<typeof bestRecord>>, number][] = [];
    for (const m of byRelease) {
      const recs = idx.get(m.id)?.get(c.bench.id);
      const r = bestRecord(recs, c.bench, f);
      if (!r) continue;
      vals.push([m, r, recs!.length]);
      lo = Math.min(lo, r.v);
      hi = Math.max(hi, r.v);
    }
    colHasData.set(c.key, vals.length > 0);
    // Use a log scale for unbounded units so a 17-hour horizon doesn't flatten everything else.
    const logScale = c.bench.unit === 'minutes' || c.bench.unit === 'usd';
    const tf = (v: number) => (logScale ? Math.log10(Math.max(v, 1e-3)) : v);
    const tlo = tf(lo);
    const thi = tf(hi);
    let best = c.bench.higherIsBetter ? -Infinity : Infinity;
    let i = 0;
    while (i < vals.length) {
      // Models released the same day compete together.
      const day = vals[i][0].released;
      const same = vals.filter(([m]) => m.released === day);
      const priorBest = best;
      for (const [m, r, n] of same) {
        const sota = c.bench.higherIsBetter ? r.v > priorBest : r.v < priorBest;
        const shade = thi > tlo ? (tf(r.v) - tlo) / (thi - tlo) : 1;
        cells.set(`${m.id}|${c.key}`, { value: r.v, rec: r, sota: sota && vals.length > 1, shade: c.bench.higherIsBetter ? shade : 1 - shade, n });
        best = c.bench.higherIsBetter ? Math.max(best, r.v) : Math.min(best, r.v);
      }
      i += same.length;
    }
  }
  return { cells, colHasData };
}
