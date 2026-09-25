import { useCallback, useMemo, useState } from 'react';
import { EChart } from '../../charts/EChart.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { useCharts } from '../../lib/data.ts';
import { monthYear } from '../../lib/format.ts';
import type { Tokens } from '../../lib/tokens.ts';

/**
 * Cost to capability, kept deliberately simple: Epoch AI's "cheapest model that reaches X% on
 * benchmark B" record staircases, and the headline rate at which that cost falls.
 * Source: https://epoch.ai/publications/the-plunging-price-of-thought (fetched by scripts/fetch/inference-cost.ts).
 */

interface CostRecord {
  bench: string;
  benchmark: string;
  level: number;
  model: string;
  acc: number;
  date: string;
  cost: number;
}
interface InferenceCost {
  fetchedAt?: string;
  records?: CostRecord[];
  declines?: { benchmark: string; declinePctPerQuarter: number }[];
}

const EPOCH_URL = 'https://epoch.ai/publications/the-plunging-price-of-thought';
// Validated with the dataviz palette checker (adjacent CVD + normal-vision floors) in both modes;
// lines are also direct-labelled and carry distinct markers.
const SERIES_DARK = ['#c98500', '#9085e9', '#008300', '#e66767'];
const SERIES_LIGHT = ['#eda100', '#4a3aa7', '#008300', '#e34948'];
const SYMBOLS = ['circle', 'diamond', 'triangle', 'rect'];

const perYear = (pctPerQuarter: number) => 1 / (1 - pctPerQuarter / 100) ** 4;
const usd = (v: number) => (v >= 1 ? `$${v.toFixed(2)}` : v >= 0.01 ? `$${v.toFixed(3)}` : `$${v.toPrecision(2)}`);
const times = (x: number) => (x >= 100 ? `${Math.round(x).toLocaleString()}×` : `${x.toFixed(x >= 10 ? 0 : 1)}×`);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

export default function CostPanel() {
  const charts = useCharts();
  const data = (charts?.inferenceCost ?? null) as InferenceCost | null;
  const records = useMemo(() => (data?.records ?? []).filter((r) => r && r.date && Number.isFinite(r.cost) && r.cost > 0), [data]);
  const declines = useMemo(() => (data?.declines ?? []).filter((d) => d && Number.isFinite(d.declinePctPerQuarter) && d.declinePctPerQuarter > 0 && d.declinePctPerQuarter < 100), [data]);

  const levels = useMemo(() => [...new Set(records.map((r) => r.level))].sort((a, b) => a - b), [records]);
  const [level, setLevel] = useState<number>(() => (levels.includes(0.75) ? 0.75 : levels[0] ?? 0.75));
  const [view, setView] = useState<'chart' | 'table'>('chart');

  // One staircase per benchmark at the chosen score bar.
  const series = useMemo(() => {
    const by = new Map<string, CostRecord[]>();
    for (const r of records) if (r.level === level) by.set(r.benchmark, [...(by.get(r.benchmark) ?? []), r]);
    return [...by.entries()]
      .map(([name, rs]) => ({ name, rs: rs.sort((a, b) => a.date.localeCompare(b.date)) }))
      .filter((s) => s.rs.length > 0)
      .sort((a, b) => b.rs.length - a.rs.length)
      .slice(0, 4);
  }, [records, level]);

  const headline = median(declines.map((d) => perYear(d.declinePctPerQuarter)));
  // A concrete example: the benchmark with the biggest first→latest drop at this bar.
  const example = useMemo(() => {
    let best: { name: string; first: CostRecord; last: CostRecord; factor: number } | null = null;
    for (const s of series) {
      if (s.rs.length < 2) continue;
      const first = s.rs[0];
      const last = s.rs[s.rs.length - 1];
      const factor = first.cost / last.cost;
      if (!best || factor > best.factor) best = { name: s.name, first, last, factor };
    }
    return best;
  }, [series]);

  const option = useCallback(
    (t: Tokens) => {
      const pal = t.theme === 'dark' ? SERIES_DARK : SERIES_LIGHT;
      return {
        grid: { left: 64, right: 150, top: 16, bottom: 36 },
        tooltip: {
          trigger: 'item',
          formatter: (p: { seriesName: string; data: { value: [string, number]; r: CostRecord } }) => {
            const r = p.data.r;
            return `<div style="font-size:11px;color:${t.text3}">${p.seriesName} · ${Math.round(level * 100)}% bar</div><div style="font-weight:600;margin:2px 0">${usd(r.cost)} per task</div><div style="color:${t.text2}">${r.model} · ${monthYear(r.date)}<br/>scored ${(r.acc * 100).toFixed(0)}%</div>`;
          },
        },
        xAxis: { type: 'time', splitLine: { show: false } },
        yAxis: { type: 'log', name: 'USD per task (log)', nameGap: 44, nameLocation: 'middle', axisLabel: { formatter: (v: number) => usd(v) } },
        series: series.map((s, i) => ({
          name: s.name,
          type: 'line',
          step: 'end',
          symbol: SYMBOLS[i % SYMBOLS.length],
          symbolSize: 9,
          lineStyle: { width: 2, color: pal[i % pal.length] },
          itemStyle: { color: pal[i % pal.length], borderColor: t.surface, borderWidth: 2 },
          // Direct label at the line end: identity never rests on colour alone.
          endLabel: { show: true, formatter: s.name, color: t.text2, fontSize: 11, fontFamily: t.font, distance: 8 },
          data: s.rs.map((r) => ({ value: [r.date, r.cost], r })),
        })),
      };
    },
    [series, level],
  );

  if (!records.length) {
    return (
      <Panel kicker="Cost to capability" title="What it costs to reach the same score">
        <p className="text-[13px] text-ink-3">No inference-cost data yet. Run <code>npm run refresh</code> (fetches Epoch AI’s cost records).</p>
      </Panel>
    );
  }

  const declineRows = [...declines].map((d) => ({ name: d.benchmark, x: perYear(d.declinePctPerQuarter) })).sort((a, b) => b.x - a.x);
  const maxX = Math.max(...declineRows.map((d) => d.x), 1);

  return (
    <Panel
      kicker="Cost to capability"
      title="What it costs to reach the same score"
      actions={
        <>
          {levels.length > 1 && (
            <Segmented
              value={String(level)}
              onChange={(v) => setLevel(Number(v))}
              options={levels.map((l) => ({ value: String(l), label: `${Math.round(l * 100)}% bar` }))}
              label="Score bar"
            />
          )}
          <Segmented value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
        </>
      }
      footer={
        <>
          Each line steps down whenever a new model reaches the same score more cheaply (cost per task at API prices). Data:{' '}
          <a className="underline decoration-line-2 underline-offset-2 hover:text-ink" href={EPOCH_URL} target="_blank" rel="noreferrer">
            Epoch AI, “The Plunging Price of Thought”
          </a>
          .
        </>
      }
    >
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="kicker mb-1">Same score, cheaper every year</div>
          <div className="text-[34px] font-semibold leading-none tracking-tight">{Number.isFinite(headline) ? `~${times(headline)}` : '—'}</div>
          <div className="mt-1.5 text-[12px] text-ink-3">median yearly drop across {declines.length} Epoch benchmarks</div>
        </div>
        {example && (
          <div className="text-[13px] leading-relaxed text-ink-2">
            <div className="kicker mb-1">For example</div>
            Reaching {Math.round(level * 100)}% on <span className="text-ink">{example.name}</span> cost <span className="font-mono text-ink">{usd(example.first.cost)}</span> per task with {example.first.model} ({monthYear(example.first.date)}). {example.last.model} does it for{' '}
            <span className="font-mono text-ink">{usd(example.last.cost)}</span> ({monthYear(example.last.date)}), <span className="text-ink">{times(example.factor)} cheaper</span>.
          </div>
        )}
      </div>

      {view === 'chart' ? (
        series.length ? (
          <EChart option={option} height={320} ariaLabel="Cheapest cost per task to reach a fixed score, over time" />
        ) : (
          <p className="py-10 text-center text-[13px] text-ink-3">No records at this score bar.</p>
        )
      ) : (
        <div className="max-h-[320px] overflow-auto rounded-xl border border-line">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-surface-2 text-left text-ink-3">
              <tr>
                <th className="px-3 py-2 font-medium">Benchmark</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Cheapest model</th>
                <th className="px-3 py-2 text-right font-medium">$ / task</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {series.flatMap((s) =>
                s.rs.map((r) => (
                  <tr key={`${s.name}${r.date}${r.model}`}>
                    <td className="px-3 py-1.5 text-ink-2">{s.name}</td>
                    <td className="px-3 py-1.5 font-mono text-ink-3">{monthYear(r.date)}</td>
                    <td className="px-3 py-1.5 text-ink">{r.model}</td>
                    <td className="px-3 py-1.5 text-right font-mono tnum">{usd(r.cost)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}

      {declineRows.length > 0 && (
        <div className="mt-5">
          <div className="kicker mb-2">How fast the price of a fixed score falls, per year</div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {declineRows.map((d) => (
              <div key={d.name} className="flex items-center gap-3 text-[12px]">
                <span className="w-44 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-ink-2" title={d.name}>
                  {d.name}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${(Math.log(d.x) / Math.log(maxX)) * 100}%` }} />
                </span>
                <span className="w-12 shrink-0 text-right font-mono tnum text-ink">{times(d.x)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
