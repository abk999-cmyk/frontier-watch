import { useCallback, useMemo, useState } from 'react';
import type { Benchmark, LabGroup } from '../../../shared/types.ts';
import { BENCH_GROUP_ORDER } from '../../../shared/types.ts';
import { Chip } from '../../components/ui/Chip.tsx';
import { InfoTip, Legend } from '../../components/ui/misc.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { GROUP_LABEL } from '../../components/ModelDrawer.tsx';
import { useCore, useScores, useTrends } from '../../lib/data.ts';
import { bootstrapFits, expWithDoubling, fitPoints, frontier, predictionBand, quantiles, timeToTarget, type Fit, type FitKind } from '../../lib/fit.ts';
import { fromYearFrac, isoFromTime, monthYear, toTime, yearFrac } from '../../lib/format.ts';
import { LAB_META } from '../../lib/labs.ts';
import { bestRecord, indexScores } from '../../lib/scores.ts';
import type { Tokens } from '../../lib/tokens.ts';
import { openModel } from '../../lib/ui-state.ts';
import { alpha, Chart, ClearFiltersButton, DataTable, EmptyState, esc, fmtHorizon, LabCell, labSymbol, RangeSlider, Readout, SearchSelect, Slider, ViewToggle, type View } from './common.tsx';
import { useChartFilters, useModelScope } from './filters.tsx';

type SeriesKind = 'eci' | 'metr' | 'bench';
type ModelChoice = 'auto' | FitKind;

const SEED = 20260924;
const BOOTS = 300;
const H_MIN = 2027;
const H_MAX = 2035;

interface Obs {
  key: string;
  x: number; // fractional year
  y: number;
  name: string;
  g: LabGroup;
  modelId?: string;
  date: string;
  open?: boolean;
}

const yfDate = (x: number) => monthYear(isoFromTime(fromYearFrac(x)));
const MODEL_LABEL: Record<FitKind, string> = { linear: 'Linear', exponential: 'Exponential', logistic: 'Logistic' };

export default function ProjectionPanel() {
  const core = useCore();
  const trends = useTrends();
  const { records } = useScores();
  const { clearAll } = useChartFilters();
  const { keep, picked, highlight } = useModelScope();

  const [series, setSeries] = useState<SeriesKind>('metr');
  const benchChoices = useMemo(
    () =>
      core.benchmarks
        .filter((b) => b.id !== 'eci' && (trends.frontierByBenchmark[b.id]?.length ?? 0) >= 3)
        .sort((a, b) => BENCH_GROUP_ORDER.indexOf(a.group) - BENCH_GROUP_ORDER.indexOf(b.group)),
    [core.benchmarks, trends.frontierByBenchmark],
  );
  const [benchId, setBenchId] = useState<string>(() => benchChoices.find((b) => b.id === 'hle')?.id ?? benchChoices[0]?.id ?? '');
  const bench: Benchmark | undefined = benchChoices.find((b) => b.id === benchId);
  const [modelChoice, setModelChoice] = useState<ModelChoice>('auto');
  const [windowSel, setWindowSel] = useState<[number, number] | null>(null);
  const [horizon, setHorizon] = useState(2030);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [whatIf, setWhatIf] = useState<{ on: boolean; months: number }>({ on: false, months: 7 });
  const [view, setView] = useState<View>('chart');

  const idx = useMemo(() => indexScores(records), [records]);

  // ── Series meta + observations ────────────────────────────────────────
  const meta = useMemo(() => {
    if (series === 'eci') return { key: 'eci', label: 'ECI', unit: 'index' as const, ceiling: null, hib: true };
    if (series === 'metr') return { key: 'metr', label: 'METR 50% horizon', unit: 'minutes' as const, ceiling: null, hib: true };
    return { key: `b:${bench?.id}`, label: bench?.short ?? 'Benchmark', unit: bench?.unit ?? 'pct', ceiling: bench?.ceiling ?? null, hib: bench?.higherIsBetter ?? true };
  }, [series, bench]);

  const obs = useMemo<Obs[]>(() => {
    let raw: Obs[] = [];
    if (series === 'eci') raw = trends.eci.map((p, i) => ({ key: `e${i}`, x: yearFrac(p.date), y: p.eci, name: p.name, g: p.labGroup, modelId: p.modelId, date: p.date, open: p.open }));
    else if (series === 'metr') raw = trends.metr.map((p, i) => ({ key: `m${i}`, x: yearFrac(p.date), y: p.p50, name: p.name, g: p.labGroup, modelId: p.modelId, date: p.date }));
    else if (bench)
      for (const m of core.models) {
        const r = bestRecord(idx.get(m.id)?.get(bench.id), bench);
        if (r) raw.push({ key: m.id, x: yearFrac(m.released), y: r.v, name: m.name, g: m.labGroup, modelId: m.id, date: m.released });
      }
    return raw.filter((o) => Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(toTime(o.date)) && keep(o));
  }, [series, bench, trends, core.models, idx, keep]);
  const pickedKeys = useMemo(() => (highlight ? new Set(obs.filter((o) => picked(o)).map((o) => o.key)) : null), [highlight, obs, picked]);

  const front = useMemo(() => frontier(obs, (o) => o.x, (o) => o.y, meta.hib), [obs, meta.hib]);
  const frontKeys = useMemo(() => new Set(front.map((o) => o.key)), [front]);
  const best = front.at(-1);

  // ── Fit window ────────────────────────────────────────────────────────
  const ext: [number, number] = useMemo(() => {
    if (!front.length) return [2023, 2027];
    const lo = Math.floor(front[0].x * 12) / 12;
    const hi = Math.ceil(front.at(-1)!.x * 12) / 12;
    return [lo, Math.max(hi, lo + 1 / 12)];
  }, [front]);
  const win: [number, number] = windowSel ? [Math.max(ext[0], Math.min(windowSel[0], ext[1])), Math.min(ext[1], Math.max(windowSel[1], ext[0]))] : ext;
  const fitPts = useMemo(() => front.filter((o) => o.x >= win[0] - 1e-9 && o.x <= win[1] + 1e-9), [front, win]);

  // ── Model + fit + bootstrap ───────────────────────────────────────────
  const autoKind: FitKind = meta.ceiling != null ? 'logistic' : meta.unit === 'index' ? 'linear' : 'exponential';
  const kind: FitKind = modelChoice === 'auto' ? autoKind : modelChoice === 'logistic' && meta.ceiling == null ? autoKind : modelChoice;
  const pts = useMemo(() => fitPts.map((o) => ({ x: o.x, y: o.y })), [fitPts]);
  const fit = useMemo(() => fitPoints(pts, kind, { ceiling: meta.ceiling }), [pts, kind, meta.ceiling]);
  const boots = useMemo(() => bootstrapFits(pts, kind, BOOTS, SEED, { ceiling: meta.ceiling }), [pts, kind, meta.ceiling]);

  const lastX = fitPts.at(-1)?.x ?? win[1];
  const overrideOn = whatIf.on && kind === 'exponential' && !!fit;
  const { eff, effBoots } = useMemo(() => {
    if (!fit) return { eff: null as Fit | null, effBoots: [] as Fit[] };
    if (!overrideOn) return { eff: fit, effBoots: boots };
    const dt = whatIf.months / 12;
    const main = expWithDoubling(lastX, fit.predict(lastX), dt);
    // Level uncertainty only: each resample keeps its own level at the anchor, with the what-if rate.
    const bs = boots.map((b) => expWithDoubling(lastX, b.predict(lastX), dt)).filter((b): b is NonNullable<typeof b> => !!b);
    return { eff: main as Fit | null, effBoots: bs as Fit[] };
  }, [fit, boots, overrideOn, whatIf.months, lastX]);

  const hEnd = horizon + 1 - 1 / 365;
  const projXs = useMemo(() => Array.from({ length: 90 }, (_, i) => lastX + ((hEnd - lastX) * i) / 89), [lastX, hEnd]);
  const band = useMemo(() => predictionBand(effBoots, projXs), [effBoots, projXs]);
  const atHorizon = band.at(-1);

  // ── Target ────────────────────────────────────────────────────────────
  const chips = useMemo(() => {
    if (series === 'metr')
      return [
        { v: 480, label: '8 h', phrase: 'an 8-hour horizon' },
        { v: 2400, label: '40 h work-week', phrase: 'a 40-hour (work-week) horizon' },
        { v: 10080, label: '1 week', phrase: 'a 1-week horizon' },
        { v: 43200, label: '1 month', phrase: 'a 1-month horizon' },
      ];
    if (series === 'eci') return [175, 200, 250].map((v) => ({ v, label: `ECI ${v}`, phrase: `ECI ${v}` }));
    if (meta.ceiling != null) return [80, 90, 95].filter((v) => v < meta.ceiling!).map((v) => ({ v, label: `${v}%`, phrase: `${v}% on ${meta.label}` }));
    return [];
  }, [series, meta.ceiling, meta.label]);
  const defaultTarget = series === 'metr' ? 10080 : series === 'eci' ? 200 : meta.ceiling != null ? Math.min(95, meta.ceiling * 0.95) : Math.round((best?.y ?? 1) * 2);
  const targetStr = targets[meta.key] ?? String(defaultTarget);
  const target = Number(targetStr);
  const targetValid = Number.isFinite(target) && target > 0;
  const fmtV = useCallback(
    (v: number) => (meta.unit === 'minutes' ? fmtHorizon(v) : meta.unit === 'pct' ? (v > 99.9 && v < 100 ? '>99.9%' : `${v.toFixed(1)}%`) : v.toFixed(1)),
    [meta.unit],
  );
  /** Linear slope per year in the series' own terms. */
  const fmtSlope = useCallback(
    (s: number) => `${s >= 0 ? '+' : '−'}${meta.unit === 'minutes' ? fmtHorizon(Math.abs(s)) : meta.unit === 'pct' ? `${Math.abs(s).toFixed(1)} pts` : `${Math.abs(s).toFixed(1)}${series === 'eci' ? ' ECI' : ''}`} / yr`,
    [meta.unit, series],
  );
  const targetShort = !targetValid ? 'target' : series === 'eci' ? `ECI ${target}` : meta.unit === 'pct' ? `${target}%` : fmtV(target);
  const targetPhrase = chips.find((c) => c.v === target)?.phrase ?? (series === 'metr' ? `a ${fmtHorizon(target)} horizon` : series === 'eci' ? `ECI ${target}` : `${fmtV(target)} on ${meta.label}`);

  const result = useMemo(() => (eff && targetValid ? timeToTarget(eff, effBoots, target, { observedBest: best?.y ?? null, higherIsBetter: meta.hib }) : null), [eff, effBoots, target, targetValid, best, meta.hib]);

  const nowX = yearFrac(Date.now());
  const pace = !eff
    ? ''
    : eff.kind === 'exponential'
      ? `${overrideOn ? 'what-if' : 'fitted'} doubling time of ${(eff.doublingTime * 12).toFixed(1)} months`
      : eff.kind === 'linear'
        ? `fitted pace of ${fmtSlope(eff.slope)}`
        : `fitted S-curve (midpoint ${yfDate(eff.midpoint)})`;
  const sentence = (() => {
    if (!eff) return `Need at least 3 frontier points in the fit window to fit a ${MODEL_LABEL[kind].toLowerCase()} curve (have ${fitPts.length}).`;
    if (!targetValid) return 'Enter a positive target value.';
    if (!result) return '';
    if (result.status === 'reached') return `${targetPhrase[0].toUpperCase()}${targetPhrase.slice(1)} is already reached: ${best?.name} hit ${fmtV(best!.y)} (${monthYear(best!.date)}).`;
    if (result.status === 'unreachable')
      return result.reason === 'ceiling' ? `A logistic curve never reaches its ${fmtV(meta.ceiling ?? 0)} ceiling. Pick a target below it.` : `On this fit the trend isn't rising, so ${targetPhrase} is never reached.`;
    const d = (x: number) => (x > 2100 ? 'after 2100' : yfDate(x));
    const hi = result.hi === Infinity ? `not on ${Math.round(result.neverShare * 100)}% of resamples` : d(result.hi);
    if (result.x < nowX) return `On the ${pace}, ${targetPhrase} was due ~${d(result.x)}, but no model has reached it yet: the trend is running ahead of the data (80%: ${d(result.lo)} – ${hi}).`;
    return `At the ${pace}, ${targetPhrase} arrives ~${d(result.x)} (80%: ${d(result.lo)} – ${hi}).`;
  })();

  // ── Presets ───────────────────────────────────────────────────────────
  const presetLongRun = () => {
    setSeries('metr');
    setModelChoice('exponential');
    setWindowSel(null);
    setWhatIf({ on: true, months: 7 });
  };
  const presetRecent = () => {
    setSeries('metr');
    setModelChoice('exponential');
    setWindowSel([2024, 2100]);
    setWhatIf((w) => ({ ...w, on: false }));
  };

  // ── Chart ─────────────────────────────────────────────────────────────
  const logY = kind === 'exponential' || meta.unit === 'minutes';
  const option = useCallback(
    (t: Tokens) => {
      const ms = (x: number) => fromYearFrac(x);
      const inWin = (o: Obs) => fitPts.includes(o);
      const others = obs.filter((o) => !frontKeys.has(o.key));
      // Highlight mode: picked models are ringed and named; the rest recede.
      const pickLabel = (o: Obs) =>
        pickedKeys?.has(o.key) ? { label: { show: true, position: 'right', distance: 6, formatter: o.name, color: t.text, fontSize: 10.5, fontFamily: t.font, backgroundColor: alpha(t.bg, 0.6), padding: [2, 4], borderRadius: 5 } } : {};
      const series: any[] = [
        {
          type: 'scatter',
          name: 'Observed',
          z: 2,
          cursor: 'pointer',
          symbolSize: 8,
          data: others.map((o) => ({
            value: [ms(o.x), o.y],
            o,
            symbol: labSymbol(o.g),
            itemStyle: pickedKeys?.has(o.key) ? { color: t.lab[o.g], opacity: 1, borderColor: t.text, borderWidth: 1.5 } : { color: t.lab[o.g], opacity: pickedKeys ? 0.1 : 0.22 },
            ...pickLabel(o),
          })),
        },
        {
          type: 'scatter',
          name: 'Frontier',
          z: 4,
          cursor: 'pointer',
          symbolSize: 11,
          data: front.map((o) => ({
            value: [ms(o.x), o.y],
            o,
            symbol: labSymbol(o.g),
            itemStyle: inWin(o) ? { color: t.lab[o.g], borderColor: t.text, borderWidth: 1.2 } : { color: alpha(t.lab[o.g], 0.25), borderColor: t.text3, borderWidth: 1 },
            ...pickLabel(o),
          })),
        },
      ];
      if (eff && fit) {
        const a = fitPts[0]?.x ?? win[0];
        const fitXs = Array.from({ length: 60 }, (_, i) => a + ((lastX - a) * i) / 59);
        series.push({
          type: 'line',
          name: 'Fit',
          silent: true,
          symbol: 'none',
          z: 3,
          lineStyle: { color: t.text, width: 2 },
          data: fitXs.map((x) => [ms(x), fit.predict(x)]),
        });
        series.push({
          type: 'custom',
          name: '80% band',
          silent: true,
          clip: true,
          z: 1,
          encode: { x: 0, y: [1, 2] },
          data: band.map((b) => [ms(b.x), b.lo, b.hi]),
          renderItem: (prm: any, api: any) => {
            if (prm.dataIndex !== 0 || band.length < 2) return null;
            const top = band.map((b) => api.coord([ms(b.x), b.hi]));
            const bot = band.map((b) => api.coord([ms(b.x), b.lo])).reverse();
            return { type: 'polygon', shape: { points: [...top, ...bot] }, style: { fill: alpha(t.accent, t.theme === 'dark' ? 0.13 : 0.16), stroke: alpha(t.accent, 0.3), lineWidth: 0.5 } };
          },
        });
        series.push({
          type: 'line',
          name: 'Projection',
          silent: true,
          symbol: 'none',
          z: 3,
          lineStyle: { color: t.accent, width: 2, type: [6, 5] },
          endLabel: { show: true, formatter: overrideOn ? `what-if projection` : 'projection', color: t.text2, fontSize: 10.5, fontFamily: t.mono, distance: 6 },
          data: projXs.map((x) => [ms(x), eff.predict(x)]),
          markLine: {
            silent: true,
            symbol: 'none',
            animation: false,
            label: { color: t.text3, fontFamily: t.mono, fontSize: 10 },
            data: [
              { xAxis: Date.now(), lineStyle: { color: t.line2, type: 'solid', width: 1 }, label: { formatter: 'today', position: 'insideEndTop' } },
              ...(targetValid ? [{ yAxis: target, lineStyle: { color: t.text3, type: [3, 3], width: 1 }, label: { formatter: `target ${fmtV(target)}`, position: 'insideStartTop' } }] : []),
              ...(meta.ceiling != null && kind === 'logistic' ? [{ yAxis: meta.ceiling, lineStyle: { color: t.line2, type: [2, 4], width: 1 }, label: { formatter: 'ceiling', position: 'insideEndBottom' } }] : []),
              ...(result?.status === 'ok' && result.x <= hEnd ? [{ xAxis: ms(result.x), lineStyle: { color: t.accent, type: 'solid', width: 1 }, label: { formatter: `~${yfDate(result.x)}`, position: 'insideEndBottom', color: t.text2 } }] : []),
            ],
          },
          markArea:
            result?.status === 'ok' && result.lo <= hEnd
              ? { silent: true, itemStyle: { color: alpha(t.accent, 0.06) }, data: [[{ xAxis: ms(Math.max(result.lo, ext[0])) }, { xAxis: ms(Math.min(result.hi, hEnd)) }]] }
              : undefined,
        });
      }

      const obsMax = Math.max(...obs.map((o) => o.y), targetValid ? target : 0);
      const obsMin = Math.min(...obs.map((o) => o.y));
      const yAxis = logY
        ? { type: 'log', name: meta.label, nameGap: 12, min: Math.max(obsMin / 3, 1e-3), max: Math.min(obsMax * 1e8, Math.max(obsMax * 4, (targetValid ? target : 0) * 3, eff ? eff.predict(hEnd) * 2 : 0)), axisLabel: { formatter: (v: number) => (meta.unit === 'minutes' ? fmtHorizon(v) : String(v)) } }
        : meta.ceiling != null && kind === 'logistic'
          ? { type: 'value', name: meta.label, nameGap: 12, min: 0, max: meta.ceiling }
          : { type: 'value', name: meta.label, nameGap: 12, scale: true };
      return {
        grid: { left: 58, right: 96, top: 26, bottom: 36 },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'line', lineStyle: { color: t.line2 } },
          formatter: (params: any) => {
            const p0 = Array.isArray(params) ? params[0] : params;
            const tms: number = p0?.axisValue ?? p0?.value?.[0];
            if (tms == null) return '';
            const x = yearFrac(tms);
            let html = `<div style="font-family:${t.mono};font-size:11px;color:${t.text3}">${yfDate(x)}</div>`;
            const near = [...front, ...obs].find((o) => Math.abs(o.x - x) < 12 / 365);
            if (near)
              html += `<div style="margin-top:4px"><span style="color:${t.lab[near.g]};font-size:11px">${LAB_META[near.g].glyph}</span> <b>${esc(near.name)}</b> <span style="font-family:${t.mono}">${fmtV(near.y)}</span>${frontKeys.has(near.key) ? ` <span style="color:${t.text3}">frontier</span>` : ''}</div>`;
            if (eff && x >= (fitPts[0]?.x ?? Infinity)) {
              const mid = x <= lastX && fit ? fit.predict(x) : eff.predict(x);
              const [lo, hi] = x > lastX ? quantiles(effBoots.map((b) => b.predict(x)), [0.1, 0.9]) : [NaN, NaN];
              html += `<div style="margin-top:4px;color:${t.text2}">${x > lastX ? 'projection' : 'fit'} <span style="font-family:${t.mono};color:${t.text}">${fmtV(mid)}</span>${Number.isFinite(lo) ? ` <span style="color:${t.text3}">(80%: ${fmtV(lo)} – ${fmtV(hi)})</span>` : ''}</div>`;
            }
            return html;
          },
        },
        xAxis: { type: 'time', splitLine: { show: false }, max: fromYearFrac(hEnd), axisLabel: { hideOverlap: true } },
        yAxis,
        series,
      };
    },
    [obs, front, frontKeys, pickedKeys, fitPts, fit, eff, effBoots, band, projXs, lastX, win, ext, hEnd, overrideOn, target, targetValid, result, meta, kind, logY, fmtV],
  );
  const onEvents = useMemo(() => ({ click: (prm: any) => prm?.data?.o?.modelId && openModel(prm.data.o.modelId) }), []);

  // ── Readouts ──────────────────────────────────────────────────────────
  const paramText = !fit
    ? '—'
    : fit.kind === 'exponential'
      ? `${fit.doublingTime > 0 ? 'doubles' : 'halves'} every ${Math.abs(fit.doublingTime * 12).toFixed(1)} mo`
      : fit.kind === 'linear'
        ? fmtSlope(fit.slope)
        : `midpoint ${yfDate(fit.midpoint)}`;
  const bootDt = useMemo(() => {
    if (kind !== 'exponential' || !boots.length) return null;
    const [lo, hi] = quantiles(
      boots.map((b) => (b.kind === 'exponential' && b.rate > 0 ? b.doublingTime * 12 : Infinity)),
      [0.1, 0.9],
    );
    return { lo, hi };
  }, [boots, kind]);
  const resultValue = !result ? '—' : result.status === 'reached' ? 'reached' : result.status === 'unreachable' ? 'never' : result.x > 2100 ? '> 2100' : yfDate(result.x);

  const benchOptions = useMemo(() => benchChoices.map((b) => ({ value: b.id, label: b.name.length > 34 ? b.short : b.name, group: GROUP_LABEL[b.group], hint: b.short })), [benchChoices]);
  const modelOptions = [
    { value: 'auto' as const, label: `Auto · ${MODEL_LABEL[autoKind].toLowerCase()}` },
    { value: 'linear' as const, label: 'Linear' },
    { value: 'exponential' as const, label: 'Exp' },
    ...(meta.ceiling != null ? [{ value: 'logistic' as const, label: 'Logistic' }] : []),
  ];

  const projRows = useMemo(() => {
    if (!eff) return [];
    const out: { year: number; mid: number; lo: number; hi: number }[] = [];
    for (let y = Math.ceil(lastX); y <= horizon + 1; y++) {
      const [lo, hi] = quantiles(effBoots.map((b) => b.predict(y)), [0.1, 0.9]);
      out.push({ year: y, mid: eff.predict(y), lo, hi });
    }
    return out;
  }, [eff, effBoots, lastX, horizon]);

  return (
    <Panel
      kicker="Projection workbench"
      title="Fit a curve, stretch it forward, see how wide the uncertainty gets"
      actions={
        <>
          <button onClick={presetLongRun} className="rounded-full border border-line px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:border-line-2 hover:text-ink" title="METR's long-run estimate: time horizons double about every 7 months (2019→)">
            METR long-run · 7-mo doubling
          </button>
          <button onClick={presetRecent} className="rounded-full border border-line px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:border-line-2 hover:text-ink" title="Exponential fit to METR frontier models since 2024">
            METR since 2024 · ~3–4-mo
          </button>
          <ViewToggle value={view} onChange={setView} />
        </>
      }
      footer={
        <>
          Fits use frontier (best-so-far) points inside the window: linear in value, exponential in log value, logistic in logit(value ÷ ceiling) with values clamped to 0.5–99.5% of the ceiling. The band is the 10th–90th percentile of {BOOTS} bootstrap refits (resampling points, seeded so it's reproducible). It shows parameter uncertainty only, not the risk that the trend itself breaks. Extrapolation is not prediction.
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Control deck */}
        <div className="space-y-4 rounded-2xl border border-line bg-surface-2/40 p-4">
          <div>
            <div className="kicker mb-1.5">Series (frontier)</div>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<SeriesKind>
                label="Series"
                value={series}
                onChange={(s) => {
                  setSeries(s);
                  setWindowSel(null);
                }}
                options={[
                  { value: 'eci', label: 'ECI' },
                  { value: 'metr', label: 'METR 50%' },
                  { value: 'bench', label: 'Bench…' },
                ]}
              />
              {series === 'bench' && (
                <SearchSelect
                  label="Benchmark"
                  value={benchId}
                  onChange={(b) => {
                    setBenchId(b);
                    setWindowSel(null);
                  }}
                  options={benchOptions}
                  width={320}
                />
              )}
            </div>
          </div>

          {front.length >= 2 && (
            <RangeSlider label="Fit window" value={win} min={ext[0]} max={ext[1]} step={1 / 12} minGap={3 / 12} onChange={setWindowSel} format={yfDate} />
          )}

          <div>
            <div className="kicker mb-1.5 flex items-center gap-1.5">
              Model
              <InfoTip>
                Auto picks logistic when the benchmark has a finite ceiling (scores can't pass 100%), linear for ECI (an IRT-scaled index that Epoch reports as points per year), and exponential (log-linear) for unbounded quantities like METR horizons.
              </InfoTip>
            </div>
            <Segmented<ModelChoice> label="Model" value={modelChoice === 'logistic' && meta.ceiling == null ? 'auto' : modelChoice} onChange={setModelChoice} options={modelOptions} />
          </div>

          <Slider label="Horizon" value={horizon} min={H_MIN} max={H_MAX} step={1} onChange={setHorizon} format={(v) => `through ${v}`} />

          <div>
            <label className="kicker mb-1.5 block" htmlFor="fw-target">
              Target {meta.unit === 'minutes' ? '(minutes)' : meta.unit === 'pct' ? '(%)' : ''}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="fw-target"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={targetStr}
                onChange={(e) => setTargets((m) => ({ ...m, [meta.key]: e.target.value }))}
                className="w-28 rounded-full border border-line bg-surface px-3 py-1 font-mono text-[12.5px] text-ink outline-none focus:border-accent"
              />
              {targetValid && meta.unit === 'minutes' && <span className="font-mono text-[11.5px] text-ink-3">= {fmtHorizon(target)}</span>}
            </div>
            {chips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <Chip key={c.v} active={target === c.v} onClick={() => setTargets((m) => ({ ...m, [meta.key]: String(c.v) }))}>
                    {c.label}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          {kind === 'exponential' && fit && (
            <div className="space-y-2 border-t border-line pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="kicker">What-if doubling time</span>
                <Chip active={whatIf.on} onClick={() => setWhatIf((w) => ({ ...w, on: !w.on }))} title="Replace the fitted growth rate with your own, anchored at the latest fitted level">
                  {whatIf.on ? 'on' : 'off'}
                </Chip>
              </div>
              <Slider
                label="Doubles every"
                value={whatIf.months}
                min={1}
                max={24}
                step={0.5}
                onChange={(v) => setWhatIf({ on: true, months: v })}
                format={(v) => `${v} mo`}
                hint={fit.kind === 'exponential' && fit.rate > 0 ? `fitted: ${(fit.doublingTime * 12).toFixed(1)} mo. What-if band shows level uncertainty only.` : 'fitted trend is not growing'}
              />
            </div>
          )}
        </div>

        {/* Readouts + chart */}
        <div className="min-w-0">
          <div className="mb-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
            <Readout label={`${MODEL_LABEL[kind]} fit`} value={paramText} sub={bootDt ? `80%: ${bootDt.lo.toFixed(1)}–${Number.isFinite(bootDt.hi) ? bootDt.hi.toFixed(1) : '∞'} mo` : fit ? `R² ${fit.r2.toFixed(2)} (${kind === 'linear' ? 'linear' : kind === 'exponential' ? 'log' : 'logit'} space)` : 'not enough points'} />
            <Readout label="Fit points" value={`${fitPts.length}`} sub={`${yfDate(win[0])} – ${yfDate(win[1])}${fit && bootDt ? ` · R² ${fit.r2.toFixed(2)}` : ''}`} />
            <Readout label={`At end of ${horizon}`} value={atHorizon && eff ? fmtV(eff.predict(hEnd)) : '—'} sub={atHorizon ? `80%: ${fmtV(atHorizon.lo)} – ${fmtV(atHorizon.hi)}` : ''} />
            <Readout accent label={`Time to ${targetShort}`} value={resultValue} sub={result?.status === 'ok' ? `80%: ${result.lo > 2100 ? '> 2100' : yfDate(result.lo)} – ${result.hi === Infinity ? 'never' : result.hi > 2100 ? '> 2100' : yfDate(result.hi)}` : result?.status === 'reached' ? `best: ${best ? fmtV(best.y) : ''}` : ''} />
          </div>

          <p className="mb-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2 text-[13px] leading-relaxed text-ink-2" aria-live="polite">
            {sentence}
          </p>

          {!front.length ? (
            <EmptyState title="No data for this series in the current filters">
              Widen the lab, release-date, model or weights filters.
              <div>
                <ClearFiltersButton onClick={clearAll} />
              </div>
            </EmptyState>
          ) : view === 'chart' ? (
            <>
              <Chart option={option} height={430} onEvents={onEvents} ariaLabel={`${meta.label} frontier with ${MODEL_LABEL[kind]} fit and projection to ${horizon}`} />
              <div className="mt-2">
                <Legend
                  items={[
                    { label: 'Frontier point (in window: ringed)', color: 'var(--text)', glyph: '◉' },
                    { label: 'Other models', color: 'var(--text-3)', glyph: '·' },
                    { label: 'Fit', color: 'var(--text)', glyph: '━' },
                    { label: overrideOn ? `What-if projection (${whatIf.months}-mo doubling)` : 'Projection', color: 'var(--accent)', dashed: true },
                    { label: '80% bootstrap band', color: 'var(--accent)', glyph: '▒' },
                  ]}
                />
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <DataTable
                caption="Frontier points"
                maxHeight={300}
                rows={[...front].reverse()}
                rowKey={(o) => o.key}
                columns={[
                  { key: 'm', label: 'Frontier model', sort: (o) => o.name, render: (o) => <LabCell g={o.g}>{o.name}</LabCell> },
                  { key: 'd', label: 'Released', sort: (o) => o.x, text: (o) => monthYear(o.date), render: (o) => monthYear(o.date) },
                  { key: 'v', label: meta.label, align: 'right', sort: (o) => o.y, render: (o) => fmtV(o.y) },
                  { key: 'w', label: 'In window', sort: (o) => (fitPts.includes(o) ? 1 : 0), render: (o) => (fitPts.includes(o) ? 'yes' : '—') },
                  { key: 'f', label: 'Fitted', align: 'right', sort: (o) => (fit ? fit.predict(o.x) : null), render: (o) => (fit ? fmtV(fit.predict(o.x)) : '—') },
                ]}
              />
              <DataTable
                caption="Projection by year"
                maxHeight={260}
                rows={projRows}
                rowKey={(r) => String(r.year)}
                empty="No projection: not enough points to fit."
                columns={[
                  { key: 'y', label: 'Jan 1 of', sort: (r) => r.year, text: (r) => String(r.year), render: (r) => r.year },
                  { key: 'm', label: overrideOn ? 'What-if' : 'Projection', align: 'right', sort: (r) => r.mid, render: (r) => fmtV(r.mid) },
                  { key: 'l', label: '80% low', align: 'right', sort: (r) => r.lo, render: (r) => fmtV(r.lo) },
                  { key: 'h', label: '80% high', align: 'right', sort: (r) => r.hi, render: (r) => fmtV(r.hi) },
                ]}
              />
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
