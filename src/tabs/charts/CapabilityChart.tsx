import { useCallback, useMemo, useState } from 'react';
import type { Benchmark, LabGroup } from '../../../shared/types.ts';
import { BENCH_GROUP_ORDER } from '../../../shared/types.ts';
import { Chip } from '../../components/ui/Chip.tsx';
import { Legend } from '../../components/ui/misc.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { GROUP_LABEL } from '../../components/ModelDrawer.tsx';
import { useCore, useScores, useTrends } from '../../lib/data.ts';
import { fitPoints, frontier } from '../../lib/fit.ts';
import { fmtValue, monthYear, toTime, yearFrac } from '../../lib/format.ts';
import { LAB_META, labVar } from '../../lib/labs.ts';
import { bestRecord, indexScores } from '../../lib/scores.ts';
import type { Tokens } from '../../lib/tokens.ts';
import { openModel } from '../../lib/ui-state.ts';
import { alpha, Chart, ClearFiltersButton, DataTable, EmptyState, fmtHorizon, LabCell, labSymbol, monthOf, Readout, SearchSelect, tipHead, tipHint, tipRows, ViewToggle, xZoom, type View } from './common.tsx';
import { ALL_GROUPS, useChartFilters, useModelScope } from './filters.tsx';

type Metric = 'eci' | 'metr' | 'bench';

interface P {
  key: string;
  t: number;
  y: number;
  lo?: number;
  hi?: number;
  name: string;
  modelId?: string;
  g: LabGroup;
  date: string;
  org?: string;
  open?: boolean;
}

interface EventLine {
  t: number;
  kind: 'pretrain' | 'vector';
  name: string;
  detail?: string;
}

export default function CapabilityChart() {
  const core = useCore();
  const trends = useTrends();
  const { records } = useScores();
  const { inRange, clearAll } = useChartFilters();
  const { keep, picked, highlight } = useModelScope();

  const [metric, setMetric] = useState<Metric>('eci');
  const benchChoices = useMemo(
    () =>
      core.benchmarks
        .filter((b) => b.id !== 'eci' && (trends.frontierByBenchmark[b.id]?.length ?? 0) > 0)
        .sort((a, b) => BENCH_GROUP_ORDER.indexOf(a.group) - BENCH_GROUP_ORDER.indexOf(b.group)),
    [core.benchmarks, trends.frontierByBenchmark],
  );
  const [benchId, setBenchId] = useState<string>(() => benchChoices.find((b) => b.id === 'hle')?.id ?? benchChoices[0]?.id ?? '');
  const bench: Benchmark | undefined = benchChoices.find((b) => b.id === benchId);
  const [showCI, setShowCI] = useState(false);
  const [showPretrain, setShowPretrain] = useState(true);
  const [showVectors, setShowVectors] = useState(true);
  const [view, setView] = useState<View>('chart');

  const idx = useMemo(() => indexScores(records), [records]);

  // All points for the chosen metric (before filters).
  const all = useMemo<P[]>(() => {
    if (metric === 'eci')
      return trends.eci.map((p, i) => ({ key: `e${i}`, t: toTime(p.date), y: p.eci, lo: p.low, hi: p.high, name: p.name, modelId: p.modelId, g: p.labGroup, date: p.date, org: p.org, open: p.open }));
    if (metric === 'metr')
      return trends.metr.map((p, i) => ({ key: `m${i}`, t: toTime(p.date), y: p.p50, lo: p.p50Low, hi: p.p50High, name: p.name, modelId: p.modelId, g: p.labGroup, date: p.date }));
    if (!bench) return [];
    const out: P[] = [];
    for (const m of core.models) {
      const r = bestRecord(idx.get(m.id)?.get(bench.id), bench);
      if (!r) continue;
      out.push({ key: m.id, t: toTime(m.released), y: r.v, lo: r.x?.ciLow, hi: r.x?.ciHigh, name: m.name, modelId: m.id, g: m.labGroup, date: m.released });
    }
    return out;
  }, [metric, bench, trends, core.models, idx]);

  const higherIsBetter = metric === 'bench' ? (bench?.higherIsBetter ?? true) : true;
  const pts = useMemo(() => all.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.y) && keep({ ...p, date: p.t })), [all, keep]);
  const pickedKeys = useMemo(() => (highlight ? new Set(pts.filter((p) => picked(p)).map((p) => p.key)) : null), [pts, picked, highlight]);
  const front = useMemo(() => frontier(pts, (p) => p.t, (p) => p.y, higherIsBetter), [pts, higherIsBetter]);
  const frontKeys = useMemo(() => new Set(front.map((p) => p.key)), [front]);

  const pretrainLines = useMemo<EventLine[]>(
    () =>
      core.models
        .filter((m) => m.pretrain === true && keep({ modelId: m.id, name: m.name, g: m.labGroup, date: m.released }))
        .map((m) => ({ t: toTime(m.released), kind: 'pretrain', name: m.name, detail: m.pretrainNote ?? undefined })),
    [core.models, keep],
  );
  const vectorLines = useMemo<EventLine[]>(
    () =>
      core.scalingVectors
        .filter((v) => inRange(v.date))
        .map((v) => ({ t: toTime(v.date), kind: 'vector', name: v.name, detail: core.models.find((m) => m.id === v.introducedBy)?.name ?? v.introducedBy })),
    [core.scalingVectors, core.models, inRange],
  );

  const unit = metric === 'eci' ? 'index' : metric === 'metr' ? 'minutes' : (bench?.unit ?? 'pct');
  const logY = unit === 'minutes';
  const fmtY = useCallback((v: number) => (unit === 'minutes' ? fmtHorizon(v) : unit === 'index' ? v.toFixed(1) : fmtValue(v, unit)), [unit]);
  const axisY = useCallback((v: number) => (unit === 'minutes' ? fmtHorizon(v) : unit === 'pct' ? `${v}%` : String(v)), [unit]);
  const metricName = metric === 'eci' ? 'ECI' : metric === 'metr' ? 'METR 50% horizon' : (bench?.short ?? 'Score');

  // Latest-12-month frontier pace, for the readout.
  const pace = useMemo(() => {
    if (front.length < 3) return null;
    const last = front.at(-1)!.t;
    const w = front.filter((p) => p.t >= last - 365.25 * 864e5 * 1.5).map((p) => ({ x: yearFrac(p.t), y: p.y }));
    const f = fitPoints(w, logY ? 'exponential' : 'linear');
    if (!f) return null;
    if (f.kind === 'exponential') return `doubling every ${(f.doublingTime * 12).toFixed(1)} mo`;
    if (f.kind === 'linear') return `${f.slope >= 0 ? '+' : ''}${f.slope.toFixed(1)}${unit === 'pct' ? ' pts' : unit === 'index' ? ' ECI' : ''} / yr`;
    return null;
  }, [front, logY, unit]);

  const groups = useMemo(() => ALL_GROUPS.filter((g) => pts.some((p) => p.g === g)), [pts]);

  const option = useCallback(
    (t: Tokens) => {
      const maxT = pts.reduce((m, p) => Math.max(m, p.t), -Infinity);
      const labSeries = groups.map((g) => ({
        type: 'scatter',
        name: LAB_META[g].label,
        symbol: labSymbol(g),
        symbolSize: g === 'other' ? 8 : 10,
        cursor: 'pointer',
        itemStyle: { color: t.lab[g], opacity: g === 'other' ? 0.5 : 0.88, borderColor: t.surface, borderWidth: 0.6 },
        emphasis: { scale: 1.5, itemStyle: { opacity: 1, borderColor: t.text, borderWidth: 1 } },
        z: g === 'other' ? 2 : 3,
        data: pts
          .filter((p) => p.g === g)
          .map((p) => {
            if (!pickedKeys) return { value: [p.t, p.y], p };
            // Highlight mode: picked models stay bright and named; everything else recedes.
            return pickedKeys.has(p.key)
              ? {
                  value: [p.t, p.y],
                  p,
                  symbolSize: 13,
                  itemStyle: { opacity: 1, borderColor: t.text, borderWidth: 1.5 },
                  label: { show: true, position: 'right', distance: 6, formatter: p.name, color: t.text, fontSize: 11, fontFamily: t.font, backgroundColor: alpha(t.bg, 0.6), padding: [2, 5], borderRadius: 6 },
                }
              : { value: [p.t, p.y], p, itemStyle: { opacity: 0.14 } };
          }),
      }));
      const series: any[] = [...labSeries];

      if (showCI) {
        const ci = pts.filter((p) => p.lo != null && p.hi != null && (!logY || (p.lo > 0 && p.hi > 0)));
        series.push({
          type: 'custom',
          name: 'CI',
          silent: true,
          clip: true,
          z: 1,
          encode: { x: 0, y: [1, 2] },
          data: ci.map((p) => [p.t, p.lo, p.hi, ALL_GROUPS.indexOf(p.g)]),
          renderItem: (_: any, api: any) => {
            const a = api.coord([api.value(0), api.value(1)]);
            const b = api.coord([api.value(0), api.value(2)]);
            const g = ALL_GROUPS[api.value(3) as number];
            return {
              type: 'group',
              children: [
                { type: 'line', shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: t.lab[g], lineWidth: 1, opacity: 0.35 } },
                { type: 'line', shape: { x1: a[0] - 2.5, y1: a[1], x2: a[0] + 2.5, y2: a[1] }, style: { stroke: t.lab[g], lineWidth: 1, opacity: 0.35 } },
                { type: 'line', shape: { x1: b[0] - 2.5, y1: b[1], x2: b[0] + 2.5, y2: b[1] }, style: { stroke: t.lab[g], lineWidth: 1, opacity: 0.35 } },
              ],
            };
          },
        });
      }

      if (front.length) {
        series.push({
          type: 'line',
          name: 'Frontier',
          step: 'end',
          silent: true,
          symbol: 'none',
          z: 4,
          lineStyle: { color: t.text, width: 2, opacity: 0.9 },
          itemStyle: { color: t.text },
          data: [...front.map((p) => [p.t, p.y]), ...(maxT > front.at(-1)!.t ? [[maxT, front.at(-1)!.y]] : [])],
          tooltip: { show: false },
        });
        // Rings on frontier points; only the latest three carry a direct label.
        series.push({
          type: 'scatter',
          name: 'Frontier points',
          z: 5,
          cursor: 'pointer',
          symbolSize: 15,
          symbol: 'circle',
          itemStyle: { color: 'transparent', borderColor: t.text, borderWidth: 1.5 },
          labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
          data: front.map((p, i) => ({
            value: [p.t, p.y],
            p,
            label: {
              show: i >= front.length - 3,
              position: 'left',
              distance: 10,
              formatter: p.name,
              color: t.text2,
              fontSize: 11,
              fontFamily: t.font,
              backgroundColor: alpha(t.bg, 0.6),
              padding: [2, 5],
              borderRadius: 6,
            },
          })),
        });
      }

      const eventLines = [...(showPretrain ? pretrainLines : []), ...(showVectors ? vectorLines : [])];
      if (eventLines.length) {
        series.push({
          type: 'line',
          name: 'Events',
          data: [],
          markLine: {
            symbol: 'none',
            animation: false,
            lineStyle: { color: t.line2, type: [3, 4], width: 1 },
            emphasis: { lineStyle: { color: t.text2, width: 1 } },
            label: { show: true, position: 'end', color: t.text3, fontSize: 11, distance: 4 },
            // ◆ glyphs sit above the plot, ⚡ just inside it, so the two rows don't collide.
            data: eventLines.map((e) => ({
              xAxis: e.t,
              name: e.name,
              ev: e,
              lineStyle: e.kind === 'vector' ? { color: alpha(t.accent, 0.45), type: [4, 4], width: 1 } : undefined,
              label: e.kind === 'pretrain' ? { formatter: '◆', position: 'end' } : { formatter: '⚡', position: 'insideEndTop', color: t.text2 },
            })),
          },
        });
      }

      return {
        grid: { left: 56, right: 28, top: 26, bottom: 64 },
        tooltip: {
          trigger: 'item',
          formatter: (prm: any) => {
            if (prm.componentType === 'markLine') {
              const e: EventLine | undefined = prm.data?.ev ?? [...pretrainLines, ...vectorLines].find((x) => x.name === prm.name);
              if (!e) return '';
              return (
                tipHead(t, null, `${e.kind === 'pretrain' ? '◆ New pre-train' : '⚡ New scaling vector'}`, monthOf(e.t)) +
                tipRows(t, [[e.kind === 'pretrain' ? 'Model' : 'Vector', e.name], ...(e.detail ? ([[e.kind === 'pretrain' ? 'Note' : 'Introduced by', e.detail]] as [string, string][]) : [])])
              );
            }
            const p: P | undefined = prm.data?.p;
            if (!p) return '';
            const rows: [string, string][] = [[metricName, fmtY(p.y)]];
            if (p.lo != null && p.hi != null) rows.push(['90% CI', `${fmtY(p.lo)} – ${fmtY(p.hi)}`]);
            if (frontKeys.has(p.key)) rows.push(['Status', 'frontier (best so far)']);
            return tipHead(t, p.g, p.name, `${p.org || LAB_META[p.g].label} · ${monthYear(p.date)}`) + tipRows(t, rows) + (p.modelId ? tipHint(t, 'Click for model details') : '');
          },
        },
        xAxis: { type: 'time', splitLine: { show: false }, axisLabel: { hideOverlap: true } },
        yAxis: logY
          ? { type: 'log', name: metricName, nameGap: 12, axisLabel: { formatter: axisY }, min: (v: any) => Math.max(v.min / 2, 1e-3) }
          : { type: 'value', name: metricName, nameGap: 12, scale: true, max: unit === 'pct' ? (v: any) => Math.min(100, Math.ceil((v.max + 4) / 10) * 10) : undefined, axisLabel: { formatter: axisY } },
        dataZoom: xZoom(t),
        series,
      };
    },
    [pts, pickedKeys, groups, front, frontKeys, showCI, showPretrain, showVectors, pretrainLines, vectorLines, logY, unit, metricName, fmtY, axisY],
  );

  const onEvents = useMemo(
    () => ({
      click: (prm: any) => {
        const id = prm?.data?.p?.modelId;
        if (id) openModel(id);
      },
    }),
    [],
  );

  const tableRows = useMemo(() => [...pts].sort((a, b) => b.t - a.t || b.y - a.y), [pts]);
  const latest = front.at(-1);

  const benchOptions = useMemo(() => benchChoices.map((b) => ({ value: b.id, label: b.name.length > 34 ? b.short : b.name, group: GROUP_LABEL[b.group], hint: b.short })), [benchChoices]);

  return (
    <Panel
      kicker="Capability over time"
      title={metric === 'eci' ? 'Epoch Capabilities Index, every model Epoch scores' : metric === 'metr' ? 'METR 50% time horizon' : `${bench?.name ?? 'Benchmark'}: each model's best score`}
      actions={
        <>
          <Segmented<Metric>
            label="Metric"
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'eci', label: 'ECI' },
              { value: 'metr', label: 'METR 50%' },
              { value: 'bench', label: 'Benchmark…' },
            ]}
          />
          {metric === 'bench' && <SearchSelect label="Benchmark" value={benchId} onChange={setBenchId} options={benchOptions} align="end" />}
          <ViewToggle value={view} onChange={setView} />
        </>
      }
      footer={
        <>
          Frontier = best score so far by release date, within the current filters. {metric === 'eci' && 'ECI covers all models Epoch rates, not just the registry; '}
          {metric === 'metr' && 'METR horizons via Epoch; log scale. '}
          Drag or use the slider to zoom (shift + wheel zooms). Click a registry model for details.
          {(pretrainLines.length === 0 || vectorLines.length === 0) && (
            <span className="block">
              {pretrainLines.length === 0 && '◆ markers appear once models.yaml flags pretrain: true. '}
              {vectorLines.length === 0 && '⚡ markers appear once data/curated/scaling-vectors.yaml exists.'}
            </span>
          )}
        </>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Readout label="Frontier now" value={latest ? fmtY(latest.y) : '—'} sub={latest ? `${latest.name} · ${monthYear(latest.date)}` : 'no data in filter'} />
        <Readout label="Recent pace" value={pace ?? '—'} sub="fit over the last 18 months of frontier" />
        <Readout label="Points" value={pts.length} sub={`${front.length} frontier steps`} />
        <div className="flex flex-col justify-center gap-1.5 rounded-xl border border-line bg-surface-2/50 px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            <Chip active={showCI} onClick={() => setShowCI((v) => !v)} title="Show 90% confidence whiskers where available">
              CI
            </Chip>
            <Chip active={showPretrain && pretrainLines.length > 0} onClick={() => setShowPretrain((v) => !v)} title={pretrainLines.length ? 'New pre-train releases' : 'No models flagged pretrain: true yet'}>
              ◆ {pretrainLines.length}
            </Chip>
            <Chip active={showVectors && vectorLines.length > 0} onClick={() => setShowVectors((v) => !v)} title={vectorLines.length ? 'New scaling-vector introductions' : 'No scaling vectors curated yet'}>
              ⚡ {vectorLines.length}
            </Chip>
          </div>
        </div>
      </div>

      {!pts.length ? (
        <EmptyState title="No points match the current filters">
          {metric === 'bench' ? `No registry model has a ${bench?.short ?? ''} score in this selection.` : 'Widen the lab, release-date, model or weights filters, or run `npm run refresh`.'}
          <div>
            <ClearFiltersButton onClick={clearAll} />
          </div>
        </EmptyState>
      ) : view === 'chart' ? (
        <>
          <Chart option={option} height={420} onEvents={onEvents} ariaLabel={`${metricName} over time scatter with frontier step line`} />
          <div className="mt-2">
            <Legend
              items={[
                ...groups.map((g) => ({ label: LAB_META[g].label, color: labVar(g), glyph: LAB_META[g].glyph })),
                { label: 'Frontier (best so far)', color: 'var(--text)', glyph: '━' },
                ...(showPretrain && pretrainLines.length ? [{ label: 'New pre-train', color: 'var(--text-3)', glyph: '◆' }] : []),
                ...(showVectors && vectorLines.length ? [{ label: 'New scaling vector', color: 'var(--text-3)', glyph: '⚡' }] : []),
              ]}
            />
          </div>
        </>
      ) : (
        <DataTable
          caption={`${metricName} by model`}
          rows={tableRows}
          rowKey={(r) => r.key}
          columns={[
            {
              key: 'name',
              label: 'Model',
              sort: (r) => r.name,
              render: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  {r.modelId ? (
                    <button className="text-left text-ink underline decoration-line-2 underline-offset-2 hover:decoration-accent" onClick={() => openModel(r.modelId!)}>
                      {r.name}
                    </button>
                  ) : (
                    <span className="text-ink">{r.name}</span>
                  )}
                  {pickedKeys?.has(r.key) && <span className="rounded-full border border-line-2 px-1.5 font-mono text-[9.5px] text-ink-3">picked</span>}
                </span>
              ),
            },
            { key: 'lab', label: 'Lab', sort: (r) => r.org || LAB_META[r.g].label, render: (r) => <LabCell g={r.g}>{r.org || LAB_META[r.g].label}</LabCell> },
            { key: 'date', label: 'Released', sort: (r) => r.t, text: (r) => monthYear(r.date), render: (r) => monthYear(r.date) },
            { key: 'v', label: metricName, align: 'right', sort: (r) => r.y, render: (r) => fmtY(r.y) },
            { key: 'ci', label: 'CI', align: 'right', sort: (r) => (r.hi != null && r.lo != null ? r.hi - r.lo : null), render: (r) => (r.lo != null && r.hi != null ? `${fmtY(r.lo)} – ${fmtY(r.hi)}` : '—') },
            { key: 'f', label: 'Frontier', sort: (r) => (frontKeys.has(r.key) ? 1 : 0), render: (r) => (frontKeys.has(r.key) ? '★' : '') },
          ]}
        />
      )}
    </Panel>
  );
}
