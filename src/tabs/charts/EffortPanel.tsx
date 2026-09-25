import { useCallback, useMemo, useState } from 'react';
import { EFFORT_ORDER, type Effort, type EffortPoint, type LabGroup } from '../../../shared/types.ts';
import { MultiSelect } from '../../components/filters/Filters.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { useCore, useTrends } from '../../lib/data.ts';
import { countBy, matchAny } from '../../lib/filters.ts';
import { linearFit } from '../../lib/fit.ts';
import { LAB_META, labVar } from '../../lib/labs.ts';
import type { Tokens } from '../../lib/tokens.ts';
import { openModel } from '../../lib/ui-state.ts';
import { alpha, Chart, ClearFiltersButton, DataTable, EmptyState, FilterRow, fmtTokens, fmtUsdShort, LabCell, labSymbol, Readout, SearchSelect, tipHead, tipHint, tipRows, ViewToggle, type View } from './common.tsx';
import { compact, listSummary } from './filterModel.ts';
import { useChartFilters, useModelScope } from './filters.tsx';

type Mode = 'levels' | 'spend';
type XMetric = 'cost' | 'tokens';

const TOP_N = 8;
const LEVELS_DEFAULT = ['gpqa-diamond', 'frontiermath-t13-v2', 'otis-mock-aime', 'arc-agi-2'];

/** Order key: named efforts by EFFORT_ORDER, then thinking budgets ("16K") by size; unknown → null. */
function effortRank(e: string): number | null {
  const i = EFFORT_ORDER.indexOf(e as Effort);
  if (i >= 0) return i;
  const m = /^(\d+(?:\.\d+)?)K$/i.exec(e);
  return m ? 100 + Number(m[1]) : null;
}
const isNamed = (e: string) => EFFORT_ORDER.includes(e as Effort);

interface ModelRow {
  key: string;
  name: string;
  /** name as the source spells it (before disambiguation), for model matching */
  raw: string;
  g: LabGroup;
  modelId?: string;
  pts: EffortPoint[];
}

const shortName = (s: string, n = 18) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default function EffortPanel() {
  const core = useCore();
  const trends = useTrends();
  const { clearAll } = useChartFilters();
  const { keep, picked, highlight } = useModelScope();

  const [mode, setMode] = useState<Mode>('levels');
  const [xMetric, setXMetric] = useState<XMetric>('cost');
  const [view, setView] = useState<View>('chart');
  const [pick, setPick] = useState<Record<string, string[]>>({});
  const [efforts, setEfforts] = useState<string[]>([]);

  const benchName = useCallback((id: string) => core.benchmarks.find((b) => b.id === id)?.short ?? id, [core.benchmarks]);

  // Group points by benchmark → model (Epoch base string).
  const byBench = useMemo(() => {
    const m = new Map<string, Map<string, ModelRow>>();
    for (const e of trends.effort) {
      let models = m.get(e.benchmark);
      if (!models) m.set(e.benchmark, (models = new Map()));
      let row = models.get(e.base);
      if (!row) models.set(e.base, (row = { key: e.base, name: e.name, raw: e.name, g: e.labGroup, modelId: e.modelId, pts: [] }));
      row.pts.push(e);
    }
    // Disambiguate display names shared by several base strings.
    for (const models of m.values()) {
      const seen = new Map<string, number>();
      for (const r of models.values()) seen.set(r.name, (seen.get(r.name) ?? 0) + 1);
      for (const r of models.values()) if ((seen.get(r.name) ?? 0) > 1) r.name = `${r.name} (${r.key})`;
    }
    return m;
  }, [trends.effort]);

  const levelBenches = useMemo(
    () => [...byBench].filter(([, models]) => [...models.values()].some((r) => new Set(r.pts.map((p) => p.effort).filter(isNamed)).size >= 2)).map(([id]) => id),
    [byBench],
  );
  const spendBenches = useMemo(
    () => [...byBench].filter(([, models]) => [...models.values()].some((r) => r.pts.some((p) => (xMetric === 'cost' ? p.costUsd : p.tokens) != null))).map(([id]) => id),
    [byBench, xMetric],
  );
  const benches = mode === 'levels' ? levelBenches : spendBenches;
  const [benchPick, setBenchPick] = useState<string>('gpqa-diamond');
  const bench = benches.includes(benchPick) ? benchPick : (LEVELS_DEFAULT.find((b) => benches.includes(b)) ?? benches[0] ?? '');
  const tokensAvailable = useMemo(() => [...byBench.values()].some((models) => [...models.values()].some((r) => r.pts.some((p) => p.tokens != null))), [byBench]);

  const xOf = useCallback((p: EffortPoint) => (xMetric === 'cost' ? p.costUsd : p.tokens), [xMetric]);

  // Models on this benchmark that pass the global filters (before the effort-level filter).
  const scoped = useMemo(() => [...(byBench.get(bench)?.values() ?? [])].filter((r) => keep({ modelId: r.modelId, name: r.raw, g: r.g, date: r.pts[0]?.date })), [byBench, bench, keep]);
  // Effort-level options: only efforts that can actually be drawn in the current view on this benchmark.
  // "By effort" plots named levels only; "vs spend" needs a cost/token value on the point.
  const effortOptions = useMemo(() => {
    const usable = scoped.flatMap((r) => r.pts).filter((p) => (mode === 'levels' ? isNamed(p.effort) : (xOf(p) ?? 0) > 0));
    const counts = countBy(usable, (p) => p.effort);
    return [...counts.keys()]
      .sort((a, b) => (effortRank(a) ?? 1e9) - (effortRank(b) ?? 1e9) || a.localeCompare(b))
      .map((e) => ({ value: e, label: e, count: counts.get(e), group: isNamed(e) ? 'Named levels' : effortRank(e) != null ? 'Thinking budgets' : 'Other' }));
  }, [scoped, mode, xOf]);
  // Defensive: ignore picks that don't exist here (e.g. carried over from another benchmark or view).
  const activeEfforts = useMemo(() => efforts.filter((e) => effortOptions.some((o) => o.value === e)), [efforts, effortOptions]);
  // With a single effort level picked, a model needs only that level (drawn as a point, not a line).
  const minLevels = activeEfforts.length === 1 ? 1 : 2;

  // Models eligible under the current mode and filters, with their best score.
  const eligible = useMemo(() => {
    const rows = scoped
      .map((r) => {
        const pts = r.pts.filter((p) => matchAny(p.effort, activeEfforts));
        if (mode === 'levels') {
          const best = new Map<string, number>();
          for (const p of pts) if (isNamed(p.effort)) best.set(p.effort, Math.max(best.get(p.effort) ?? -Infinity, p.score));
          return { r, pts, levels: best, best: best.size ? Math.max(...best.values()) : -Infinity, n: best.size };
        }
        const withX = pts.filter((p) => (xOf(p) ?? 0) > 0 && Number.isFinite(p.score));
        return { r, pts: withX, levels: new Map<string, number>(), best: Math.max(-Infinity, ...withX.map((p) => p.score)), n: withX.length };
      })
      .filter((x) => (mode === 'levels' ? x.n >= minLevels : x.n >= 1));
    return rows.sort((a, b) => b.best - a.best);
  }, [scoped, activeEfforts, minLevels, mode, xOf]);

  const selKey = `${mode}|${bench}|${xMetric}`;
  const topKeys = useMemo(() => eligible.slice(0, TOP_N).map((x) => x.r.key), [eligible]);
  // Highlight mode: the globally picked models become the default selection here.
  const defaultKeys = useMemo(() => {
    const hi = highlight ? eligible.filter((x) => picked({ modelId: x.r.modelId, name: x.r.raw })).map((x) => x.r.key) : [];
    return hi.length ? hi : topKeys;
  }, [highlight, eligible, picked, topKeys]);
  const selected = useMemo(() => {
    const ok = new Set(eligible.map((x) => x.r.key));
    const own = pick[selKey];
    return (own?.length ? own : defaultKeys).filter((k) => ok.has(k));
  }, [pick, selKey, defaultKeys, eligible]);
  const selSet = useMemo(() => new Set(selected), [selected]);
  const chosen = useMemo(() => eligible.filter((x) => selSet.has(x.r.key)), [eligible, selSet]);

  // ── (a) score by effort level ─────────────────────────────────────────
  const levelAxis = useMemo(() => EFFORT_ORDER.filter((e) => chosen.some((x) => x.levels.has(e))), [chosen]);

  // ── (b) score vs spend: per model, points in effort order (best score per effort) ──
  const spendLines = useMemo(() => {
    if (mode !== 'spend') return [];
    return chosen.map(({ r, pts }) => {
      const byEffort = new Map<string, EffortPoint>();
      const loose: EffortPoint[] = [];
      for (const p of pts) {
        if (!((xOf(p) ?? 0) > 0)) continue;
        if (effortRank(p.effort) == null) {
          loose.push(p);
          continue;
        }
        const prev = byEffort.get(p.effort);
        if (!prev || p.score > prev.score) byEffort.set(p.effort, p);
      }
      const ordered = [...byEffort.values()].sort((a, b) => effortRank(a.effort)! - effortRank(b.effort)! || xOf(a)! - xOf(b)!);
      return { r, ordered, loose };
    });
  }, [mode, chosen, xOf]);
  const context = useMemo(() => {
    if (mode !== 'spend') return [];
    return eligible.filter((x) => !selSet.has(x.r.key)).flatMap((x) => x.pts.map((p) => ({ p, g: x.r.g, name: x.r.name })));
  }, [mode, eligible, selSet, xOf]);

  // Readouts.
  const stat = useMemo(() => {
    if (mode === 'levels') {
      const gains = chosen
        .map((x) => {
          const vals = EFFORT_ORDER.filter((e) => x.levels.has(e)).map((e) => x.levels.get(e)!);
          return vals.length >= 2 ? vals.at(-1)! - vals[0] : null;
        })
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b);
      const med = gains.length ? gains[Math.floor(gains.length / 2)] : null;
      return { a: med, n: gains.length };
    }
    // Points gained per 10× spend: linear fit of score on log10(x), per model.
    const slopes = spendLines
      .map(({ ordered }) => linearFit(ordered.map((p) => Math.log10(xOf(p)!)), ordered.map((p) => p.score)))
      .filter((f): f is NonNullable<typeof f> => !!f && f.kind === 'linear')
      .map((f) => f.slope)
      .sort((a, b) => a - b);
    return { a: slopes.length ? slopes[Math.floor(slopes.length / 2)] : null, n: slopes.length };
  }, [mode, chosen, spendLines, xOf]);

  const fmtX = xMetric === 'cost' ? fmtUsdShort : fmtTokens;

  const option = useCallback(
    (t: Tokens) => {
      if (mode === 'levels') {
        const series = chosen.map(({ r, levels }) => ({
          type: 'line',
          name: r.name,
          symbol: labSymbol(r.g),
          symbolSize: 9,
          connectNulls: true,
          cursor: 'pointer',
          lineStyle: { color: t.lab[r.g], width: 2, opacity: 0.9 },
          itemStyle: { color: t.lab[r.g], borderColor: t.surface, borderWidth: 1 },
          emphasis: { focus: 'series', lineStyle: { width: 3 } },
          blur: { lineStyle: { opacity: 0.12 }, itemStyle: { opacity: 0.15 } },
          endLabel: { show: true, formatter: shortName(r.name), color: t.text2, fontSize: 10.5, fontFamily: t.font, distance: 6 },
          labelLayout: { moveOverlap: 'shiftY' },
          data: levelAxis.filter((e) => levels.has(e)).map((e) => ({ value: [e, levels.get(e)!], r, effort: e })),
        }));
        return {
          grid: { left: 44, right: 118, top: 20, bottom: 58 },
          tooltip: {
            trigger: 'item',
            formatter: (prm: any) => {
              const r: ModelRow | undefined = prm.data?.r;
              if (!r) return '';
              return tipHead(t, r.g, r.name, LAB_META[r.g].label) + tipRows(t, [['Effort', prm.data.effort], ['Score', `${prm.data.value[1].toFixed(1)}%`]]) + (r.modelId ? tipHint(t, 'Click for model details') : '');
            },
          },
          legend: { type: 'scroll', bottom: 0, left: 8, right: 8, data: chosen.map(({ r }) => ({ name: r.name, icon: labSymbol(r.g) })), pageIconColor: t.text2, pageIconInactiveColor: t.text3, pageTextStyle: { color: t.text3 } },
          xAxis: { type: 'category', data: levelAxis, boundaryGap: false, name: 'effort', nameLocation: 'middle', nameGap: 26, axisLabel: { color: t.text2 } },
          yAxis: { type: 'value', name: 'score %', nameGap: 10, scale: true, max: (v: any) => Math.min(100, Math.ceil(v.max / 5) * 5 + 2) },
          series,
        };
      }
      const series: any[] = [];
      if (context.length) {
        series.push({
          type: 'scatter',
          name: 'Other models',
          symbolSize: 8,
          z: 1,
          cursor: 'pointer',
          data: context.map((c) => ({ value: [xOf(c.p), c.p.score], p: c.p, g: c.g, name: c.name, symbol: labSymbol(c.g), itemStyle: { color: alpha(t.lab[c.g], 0.28) } })),
        });
      }
      for (const { r, ordered, loose } of spendLines) {
        const all = [...ordered, ...loose];
        const top = all.reduce<EffortPoint | null>((m, p) => (!m || p.score > m.score ? p : m), null);
        const item = (p: EffortPoint) => ({
          value: [xOf(p), p.score],
          p,
          g: r.g,
          name: r.name,
          label: p === top ? { show: true, formatter: shortName(r.name, 16), position: 'top', distance: 6, color: t.text2, fontSize: 10.5, fontFamily: t.font } : undefined,
        });
        series.push({
          type: 'line',
          name: r.name,
          symbol: labSymbol(r.g),
          symbolSize: 9,
          z: 3,
          cursor: 'pointer',
          lineStyle: { color: t.lab[r.g], width: 1.2, opacity: 0.8 },
          itemStyle: { color: t.lab[r.g], borderColor: t.surface, borderWidth: 1 },
          emphasis: { focus: 'series' },
          blur: { lineStyle: { opacity: 0.1 }, itemStyle: { opacity: 0.15 } },
          labelLayout: { hideOverlap: true },
          data: ordered.map(item),
        });
        if (loose.length)
          series.push({
            type: 'scatter',
            name: r.name,
            symbol: labSymbol(r.g),
            symbolSize: 9,
            z: 3,
            cursor: 'pointer',
            itemStyle: { color: t.lab[r.g], borderColor: t.surface, borderWidth: 1 },
            emphasis: { focus: 'series' },
            labelLayout: { hideOverlap: true },
            data: loose.map(item),
          });
      }
      return {
        grid: { left: 44, right: 20, top: 20, bottom: 58 },
        tooltip: {
          trigger: 'item',
          formatter: (prm: any) => {
            const p: EffortPoint | undefined = prm.data?.p;
            if (!p) return '';
            const rows: [string, string][] = [
              ['Effort', p.effort],
              ['Score', `${p.score.toFixed(1)}%`],
            ];
            if (p.costUsd != null) rows.push(['Cost / task', fmtUsdShort(p.costUsd)]);
            if (p.tokens != null) rows.push(['Output tokens', fmtTokens(p.tokens)]);
            return tipHead(t, prm.data.g, prm.data.name, LAB_META[prm.data.g as LabGroup].label) + tipRows(t, rows) + (p.modelId ? tipHint(t, 'Click for model details') : '');
          },
        },
        legend: { type: 'scroll', bottom: 0, left: 8, right: 8, data: chosen.map(({ r }) => ({ name: r.name, icon: labSymbol(r.g) })), pageIconColor: t.text2, pageIconInactiveColor: t.text3, pageTextStyle: { color: t.text3 } },
        xAxis: { type: 'log', name: xMetric === 'cost' ? 'cost per task (log)' : 'output tokens per task (log)', nameLocation: 'middle', nameGap: 26, axisLabel: { formatter: fmtX } },
        yAxis: { type: 'value', name: 'score %', nameGap: 10, scale: true, max: (v: any) => Math.min(100, Math.ceil(v.max / 5) * 5 + 2) },
        series,
      };
    },
    [mode, chosen, levelAxis, spendLines, context, xOf, xMetric, fmtX],
  );

  const onEvents = useMemo(
    () => ({
      click: (prm: any) => {
        const id = prm?.data?.r?.modelId ?? prm?.data?.p?.modelId;
        if (id) openModel(id);
      },
    }),
    [],
  );

  const options = useMemo(() => eligible.map((x) => ({ value: x.r.key, label: x.r.name, color: labVar(x.r.g), glyph: LAB_META[x.r.g].glyph, hint: `best ${x.best.toFixed(0)}%` })), [eligible]);
  const benchOptions = useMemo(() => benches.map((b) => ({ value: b, label: benchName(b), hint: `${byBench.get(b)?.size ?? 0} models` })), [benches, benchName, byBench]);
  const nameOfKey = useCallback((k: string) => eligible.find((x) => x.r.key === k)?.r.name ?? k, [eligible]);
  const ownPick = pick[selKey] ?? [];
  const clearLocal = () => {
    setPick((m) => ({ ...m, [selKey]: [] }));
    setEfforts([]);
  };
  const pills = compact([
    ownPick.length > 0 && { key: 'models', label: `Models: ${listSummary(ownPick, nameOfKey)}`, onClear: () => setPick((m) => ({ ...m, [selKey]: [] })) },
    activeEfforts.length > 0 && { key: 'efforts', label: `Effort: ${listSummary(activeEfforts, (e) => e, 3)}`, onClear: () => setEfforts([]) },
  ]);
  const unnamedCount = useMemo(() => (byBench.get(bench) ? [...byBench.get(bench)!.values()].reduce((n, r) => n + r.pts.filter((p) => !isNamed(p.effort)).length, 0) : 0), [byBench, bench]);

  return (
    <Panel
      kicker="Effort vs tokens"
      title={mode === 'levels' ? 'Does thinking harder pay off?' : 'What each extra point costs'}
      actions={
        <>
          <Segmented<Mode>
            label="View"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'levels', label: 'By effort' },
              { value: 'spend', label: 'vs spend' },
            ]}
          />
          <ViewToggle value={view} onChange={setView} />
        </>
      }
      footer={
        mode === 'levels' ? (
          <>
            One line per model across named effort levels (none → promax); only models with ≥ 2 levels. Repeated runs at a level keep the best score.
            {unnamedCount > 0 && ` ${unnamedCount} points use token budgets (e.g. 32K) or unknown effort and appear only in “vs spend”.`}
          </>
        ) : (
          <>Each model's effort levels are joined in effort order (thinking budgets after named levels); unconnected marks have unknown effort. Faint marks are models outside your selection. Log x axis: flattening lines mean diminishing returns.</>
        )
      }
    >
      <FilterRow pills={pills} onClearAll={clearLocal} count={chosen.length} total={eligible.length} noun="models plotted">
        <SearchSelect label="Benchmark" value={bench} onChange={setBenchPick} options={benchOptions} />
        {mode === 'spend' && (
          <Segmented<XMetric>
            label="X axis"
            value={xMetric}
            onChange={setXMetric}
            options={[
              { value: 'cost', label: 'USD / task' },
              { value: 'tokens', label: 'Tokens', title: tokensAvailable ? 'Output tokens per task (DeepSWE, CursorBench)' : 'No token counts in the data' },
            ]}
          />
        )}
        <MultiSelect label="Models" options={options} value={selected} onChange={(v) => setPick((m) => ({ ...m, [selKey]: v }))} searchable width={320} />
        {effortOptions.length > 0 && <MultiSelect label="Effort" options={effortOptions} value={activeEfforts} onChange={setEfforts} width={260} />}
      </FilterRow>

      <div className="mb-3 grid grid-cols-2 gap-2">
        {mode === 'levels' ? (
          <Readout label="Median gain, lowest → highest effort" value={stat.a != null ? `${stat.a >= 0 ? '+' : ''}${stat.a.toFixed(1)} pts` : '—'} sub={stat.n ? `across ${stat.n} selected models on ${benchName(bench)}` : 'pick 2+ effort levels to measure the gain'} />
        ) : (
          <Readout label={`Points per 10× ${xMetric === 'cost' ? 'spend' : 'tokens'}`} value={stat.a != null ? `${stat.a >= 0 ? '+' : ''}${stat.a.toFixed(1)} pts` : '—'} sub={stat.n ? `median slope over ${stat.n} models (≥ 3 levels)` : 'needs models with ≥ 3 effort levels'} />
        )}
        <Readout
          label="Models shown"
          value={`${chosen.length} / ${eligible.length}`}
          sub={ownPick.length ? 'your pick (clear it to reset)' : defaultKeys === topKeys ? `top ${TOP_N} by best score · pick in “Models”` : 'globally picked models'}
        />
      </div>

      {!benches.length ? (
        <EmptyState title={mode === 'levels' ? 'No multi-level effort data yet' : `No ${xMetric === 'cost' ? 'cost' : 'token'} data yet`}>Run `npm run refresh` to pull Epoch effort sweeps.</EmptyState>
      ) : !chosen.length ? (
        <EmptyState title="Nothing to plot">
          {eligible.length ? 'Pick at least one model.' : 'No model in the current filters has enough effort levels on this benchmark.'}
          <div className="flex flex-wrap justify-center gap-2">
            {(activeEfforts.length > 0 || ownPick.length > 0) && <ClearFiltersButton onClick={clearLocal}>Clear panel filters</ClearFiltersButton>}
            <ClearFiltersButton onClick={clearAll}>Clear global filters</ClearFiltersButton>
          </div>
        </EmptyState>
      ) : view === 'chart' ? (
        <Chart option={option} height={360} onEvents={onEvents} ariaLabel={mode === 'levels' ? `Score by effort level on ${benchName(bench)}` : `Score versus ${xMetric} on ${benchName(bench)}`} />
      ) : mode === 'levels' ? (
        <DataTable
          caption="Score by effort level"
          rows={chosen}
          rowKey={(x) => x.r.key}
          columns={[
            { key: 'm', label: 'Model', sort: (x) => x.r.name, render: (x) => <LabCell g={x.r.g}>{x.r.name}</LabCell> },
            ...levelAxis.map((e) => ({
              key: e,
              label: e,
              align: 'right' as const,
              sort: (x: (typeof chosen)[number]) => x.levels.get(e) ?? null,
              render: (x: (typeof chosen)[number]) => (x.levels.has(e) ? `${x.levels.get(e)!.toFixed(1)}` : '—'),
            })),
          ]}
        />
      ) : (
        <DataTable
          caption="Score versus spend"
          rows={spendLines.flatMap(({ r, ordered, loose }) => [...ordered, ...loose].map((p) => ({ r, p })))}
          rowKey={(x, i) => `${x.r.key}|${x.p.effort}|${i}`}
          columns={[
            { key: 'm', label: 'Model', sort: (x) => x.r.name, render: (x) => <LabCell g={x.r.g}>{x.r.name}</LabCell> },
            { key: 'e', label: 'Effort', sort: (x) => effortRank(x.p.effort), text: (x) => x.p.effort, render: (x) => x.p.effort },
            { key: 'c', label: 'Cost / task', align: 'right', sort: (x) => x.p.costUsd, render: (x) => (x.p.costUsd != null ? fmtUsdShort(x.p.costUsd) : '—') },
            { key: 't', label: 'Tokens', align: 'right', sort: (x) => x.p.tokens, render: (x) => (x.p.tokens != null ? fmtTokens(x.p.tokens) : '—') },
            { key: 's', label: 'Score', align: 'right', sort: (x) => x.p.score, render: (x) => `${x.p.score.toFixed(1)}%` },
          ]}
        />
      )}
    </Panel>
  );
}
