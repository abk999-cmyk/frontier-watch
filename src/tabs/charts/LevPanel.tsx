import type { EChartsOption } from 'echarts';
import { useCallback, useMemo, useState } from 'react';
import { EChart } from '../../charts/EChart.tsx';
import { MultiSelect, RangeFilter, ToggleFilter, type Option } from '../../components/filters/Filters.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { InfoTip, Legend } from '../../components/ui/misc.tsx';
import { useCharts } from '../../lib/data.ts';
import { countBy, matchAny, type RangeValue } from '../../lib/filters.ts';
import { fromYearFrac, isoFromTime, shortDate } from '../../lib/format.ts';
import { useTokens, type Tokens } from '../../lib/tokens.ts';
import {
  gainRate,
  latestPerForecaster,
  medianAge,
  olsSlope,
  parseLev,
  parseLifeExpectancy,
  parseSurvival,
  type LevForecast,
  type LevModel,
  type ManifoldMarket,
  type SurvivalEra,
} from './cbData.ts';
import {
  alpha,
  catPalette,
  CountUp,
  EmptyState,
  ExtLink,
  FilterEmpty,
  HeroRow,
  HeroStat,
  Notice,
  ordinalRamp,
  SortTable,
  Swap,
  TT_CSS,
  ttHead,
  ttNote,
  ttRow,
  type Col,
} from './cbUi.tsx';
import { FilterRow } from './common.tsx';
import { compact, listSummary, rangePill } from './filterModel.ts';

type View = 'chart' | 'table';
type Metric = 'e0' | 'e65';
type Curve = 'survival' | 'cohort';

const GRID_X = { left: 56, right: 78 }; // right room for the clipped "IQR → 2110" label
/** Comparison countries in fixed colour order: categorical slots 2–7 (slot 1 is the record line). */
const COUNTRY_ORDER = ['Japan', 'United States', 'United Kingdom', 'France', 'South Korea', 'World'];
const THIS_YEAR = new Date().getUTCFullYear();
const METRIC_LABEL: Record<Metric, string> = { e0: 'at birth', e65: 'at 65 (remaining years)' };
const DEFAULT_COUNTRIES = ['Japan', 'United States'];
const DEFAULT_YEARS: RangeValue = { min: 1950 };
/** Does a forecast's year (or stated range) touch the [lo, hi] window? */
const forecastIn = (f: LevForecast, lo: number, hi: number) => (f.median != null ? f.median >= lo && f.median <= hi : f.low != null && f.high != null && f.high >= lo && f.low <= hi);

const fmtRate = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
const yearLabel = (x: number) => (Math.abs(x - Math.round(x)) < 0.02 ? String(Math.round(x)) : isoFromTime(fromYearFrac(x)).slice(0, 7));
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

/** Area under the survival curve (trapezoid over the tabulated ages) ≈ life expectancy at birth. */
function areaE0(points: [number, number][]): number | null {
  if (points.length < 3 || points[0][0] !== 0) return null;
  let s = 0;
  for (let i = 1; i < points.length; i++) s += ((points[i - 1][1] + points[i][1]) / 200) * (points[i][0] - points[i - 1][0]);
  return s;
}

export default function LevPanel() {
  const charts = useCharts();
  const t = useTokens();
  const lev = useMemo(() => parseLev(charts?.lev), [charts]);
  const le = useMemo(() => parseLifeExpectancy(charts?.lifeExpectancy), [charts]);
  const eras = useMemo(() => parseSurvival(charts?.survival), [charts]);

  const [view, setView] = useState<View>('chart');
  const [metric, setMetric] = useState<Metric>('e0');
  const [curve, setCurve] = useState<Curve>('survival');
  // Filters. Empty country pick = every country (kit convention); the default view picks two.
  const [picked, setPicked] = useState<string[]>(DEFAULT_COUNTRIES);
  const [years, setYears] = useState<RangeValue>(DEFAULT_YEARS);
  const [sources, setSources] = useState<string[]>([]);
  const [hideForecasts, setHideForecasts] = useState(false);
  const clearFilters = useCallback(() => {
    setPicked([]);
    setYears({});
    setSources([]);
    setHideForecasts(false);
  }, []);

  // ── gains per calendar year ───────────────────────────────────────────────
  const recordGain = useMemo(() => (le ? gainRate(new Map([...le.record].map(([y, r]) => [y, r.v]))) : []), [le]);
  const countryOptions = useMemo(() => (le ? [...COUNTRY_ORDER.filter((c) => le.remaining.has(c)), ...[...le.remaining.keys()].filter((c) => !COUNTRY_ORDER.includes(c))].slice(0, 6) : []), [le]);
  const countries = useMemo(() => countryOptions.filter((c) => matchAny(c, picked)), [countryOptions, picked]);
  const countryGain = useMemo(() => {
    const out = new Map<string, [number, number][]>();
    for (const c of countries) {
      const s = new Map<number, number>();
      for (const [y, r] of le!.remaining.get(c)!) if (r[metric] != null) s.set(y, r[metric]!);
      out.set(c, gainRate(s));
    }
    return out;
  }, [le, countries, metric]);
  const showRecord = metric === 'e0' && recordGain.length > 0;
  const color = useCallback((name: string, t: Tokens) => (name === 'record' ? catPalette(t)[0] : (catPalette(t)[1 + countryOptions.indexOf(name)] ?? t.lab.other)), [countryOptions]);

  const allForecasts = useMemo(() => lev?.forecasts ?? [], [lev]);
  const allMarked = useMemo(() => latestPerForecaster(allForecasts), [allForecasts]);
  const allAnnotations = useMemo(() => lev?.annotations ?? [], [lev]);
  const metaculus = allForecasts.find((f) => f.kind === 'metaculus') ?? null;

  // Year window: the domain spans all the data; the filter narrows it.
  const yearDomain = useMemo<[number, number]>(() => {
    const lo = le ? Math.min(...[...le.record.keys(), ...[...le.remaining.values()].flatMap((m) => [...m.keys()])]) : Math.min(2000, ...allAnnotations.map((a) => Math.floor(a.x)));
    const hi = Math.ceil((Math.max(THIS_YEAR + 5, ...allMarked.map((f) => f.median ?? f.high ?? f.low ?? 0)) + 2) / 5) * 5;
    return [Math.floor(lo / 10) * 10, hi];
  }, [le, allAnnotations, allMarked]);
  const xMin = Math.max(yearDomain[0], years.min ?? yearDomain[0]);
  const xMax = Math.min(yearDomain[1], years.max ?? yearDomain[1]);
  const marked = useMemo(() => (hideForecasts ? [] : allMarked.filter((f) => matchAny(f.source, sources) && forecastIn(f, xMin, xMax))), [allMarked, hideForecasts, sources, xMin, xMax]);
  const forecasts = useMemo(() => (hideForecasts ? [] : allForecasts.filter((f) => matchAny(f.source, sources))), [allForecasts, hideForecasts, sources]);
  const annotations = useMemo(() => allAnnotations.filter((a) => a.x >= xMin && a.x <= xMax + 1), [allAnnotations, xMin, xMax]);

  const gainsOption = useCallback(
    (t: Tokens): EChartsOption => {
      const series: any[] = [];
      const line = (name: string, data: [number, number][], width = 2) => ({
        type: 'line',
        name,
        data: data.filter(([y]) => y >= xMin - 1),
        showSymbol: false,
        symbolSize: 8,
        lineStyle: { width, color: color(name, t) },
        itemStyle: { color: color(name, t), borderColor: t.surface, borderWidth: 2 },
        emphasis: { focus: 'series' },
        z: name === 'record' ? 4 : 3,
      });
      if (showRecord) series.push(line('record', recordGain, 2.5));
      for (const c of countries) series.push(line(c, countryGain.get(c) ?? []));

      // The 1.0 threshold and the escape-velocity zone above it, on a helper series so they render without LE data.
      series.push({
        type: 'line',
        name: '__threshold',
        data: [],
        silent: true,
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: t.accent, width: 1.5, type: [6, 4] },
          label: { formatter: 'escape velocity · 1.0 y/y', position: 'insideStartTop', color: t.text2, fontFamily: t.mono, fontSize: 10.5 },
          data: [{ yAxis: 1 }],
        },
        markArea: { silent: true, itemStyle: { color: alpha(t.accent, 0.05) }, data: [[{ yAxis: 1 }, {}]] }, // open corner = axis extent
      });

      // Forecasts: point forecasts are hollow diamonds ON the threshold at their year (+ a dashed drop line);
      // stated ranges and Metaculus's IQR are translucent bands along the threshold.
      const points = marked.filter((f) => f.median != null);
      const ranges = marked.filter((f) => f.low != null && f.high != null);
      const pos = new Map(marked.map((f, i) => [f.id, i % 2 ? 'bottom' : 'top']));
      series.push({
        type: 'scatter',
        name: '__forecasts',
        z: 6,
        symbol: 'diamond',
        symbolSize: 13,
        itemStyle: { color: t.surface, borderColor: t.text, borderWidth: 2 },
        data: points.map((f) => ({
          value: [f.median, 1],
          label: { show: true, position: pos.get(f.id), distance: 9, formatter: `${f.source} ${f.label}`, color: t.text2, fontFamily: t.mono, fontSize: 10 },
        })),
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: t.line2, width: 1, type: [3, 4] },
          label: { show: false },
          data: points.map((f) => ({ xAxis: f.median })),
        },
      });
      if (ranges.length)
        series.push({
          type: 'line',
          name: '__ranges',
          data: [],
          silent: true,
          markLine: {
            silent: true,
            symbol: 'none',
            data: ranges.map((f) => {
              const hi = Math.min(f.high!, xMax);
              const range = f.rangeKind === 'stated';
              return [
                {
                  coord: [Math.max(f.low!, xMin), 1],
                  lineStyle: { color: alpha(t.theme === 'light' ? '#0b0d12' : '#eef2f8', range ? 0.3 : 0.16), width: range ? 7 : 5, type: 'solid', cap: 'round' },
                  label: range
                    ? { show: true, position: pos.get(f.id) === 'top' ? 'insideStartTop' : 'insideStartBottom', formatter: `${f.source} ${f.label}`, color: t.text2, fontFamily: t.mono, fontSize: 10, distance: 8 }
                    : f.high! > xMax
                      ? { show: true, position: 'end', formatter: `IQR → ${yearLabel(f.high!).slice(0, 4)}`, color: t.text3, fontFamily: t.mono, fontSize: 9.5 }
                      : { show: false },
                },
                { coord: [hi, 1] },
              ];
            }),
          },
        });
      return {
        grid: { ...GRID_X, top: 30, bottom: 30 },
        xAxis: { type: 'value', min: xMin, max: xMax, splitLine: { show: false }, axisLabel: { formatter: (v: number) => String(v) } },
        yAxis: {
          type: 'value',
          name: 'years gained per year',
          nameLocation: 'end',
          nameGap: 12,
          nameTextStyle: { align: 'left' },
          // Always show the 1.0 threshold with headroom; leave the min to ECharts' nice rounding (includes 0).
          max: (v: { max: number }) => (v.max <= 1.1 ? 1.2 : Math.ceil((v.max + 0.05) * 2) / 2),
          axisLabel: { formatter: (v: number) => v.toFixed(1) },
        },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'line', lineStyle: { color: t.line2 } },
          extraCssText: TT_CSS,
          formatter: (ps: any) => {
            const list = Array.isArray(ps) ? ps : [ps];
            const x = Number(list[0]?.axisValue);
            if (!Number.isFinite(x)) return '';
            let html = ttHead(t, String(Math.round(x)), `5-yr mean gain ${metric === 'e0' ? 'at birth' : 'at 65'}`);
            let any = false;
            for (const p of list) {
              if (p.seriesName?.startsWith('__') || !Array.isArray(p.value)) continue;
              const [yr, v] = p.value as [number, number];
              if (Math.abs(yr - x) > 1.01) continue;
              any = true;
              const holder = p.seriesName === 'record' ? le?.record.get(yr)?.holder : null;
              html += ttRow(t, color(p.seriesName, t), p.seriesName === 'record' ? `Record (female)${holder ? ` · ${holder}` : ''}` : p.seriesName, `${fmtRate(v)} y/y`);
            }
            const tol = Math.max(0.75, (xMax - xMin) / 110);
            for (const f of marked) {
              const hit = f.median != null ? Math.abs(f.median - x) <= tol : x >= f.low! - tol && x <= f.high! + tol;
              if (!hit) continue;
              any = true;
              html += ttRow(t, t.text, `◆ ${f.source}${f.kind === 'metaculus' ? ' median' : ''}`, f.label);
              const extra = [
                f.rangeKind === 'iqr' && f.low != null && f.high != null ? `IQR ${yearLabel(f.low).slice(0, 4)}–${yearLabel(f.high).slice(0, 4)}` : null,
                f.forecasters ? `${f.forecasters} forecasters` : null,
                f.probability != null ? `${f.probability}% by then` : null,
                f.published ? `stated ${shortDate(f.published)}` : null,
              ]
                .filter(Boolean)
                .join(' · ');
              if (extra) html += ttNote(t, extra);
            }
            return any ? html : '';
          },
        },
        series,
      } as EChartsOption;
    },
    [showRecord, recordGain, countries, countryGain, marked, xMin, xMax, color, metric, le],
  );

  // AI-bio milestones strip under the gains chart (same x range + grid), staggered into rows.
  const annRows = useMemo(() => {
    const minGap = (xMax - xMin) / 34;
    const last = [-Infinity, -Infinity, -Infinity];
    return annotations.map((a) => {
      let r = last.findIndex((l) => a.x - l >= minGap);
      if (r < 0) r = last.indexOf(Math.min(...last));
      last[r] = a.x;
      return r;
    });
  }, [annotations, xMin, xMax]);
  const nRows = annotations.length ? Math.max(...annRows) + 1 : 1;
  const annOption = useCallback(
    (t: Tokens): EChartsOption => ({
      animationDuration: 400,
      grid: { ...GRID_X, top: 10, bottom: 8 },
      xAxis: { type: 'value', min: xMin, max: xMax, axisLabel: { show: false }, axisLine: { show: false }, splitLine: { show: false } },
      yAxis: { type: 'value', min: -0.6, max: nRows - 0.4, show: false },
      tooltip: {
        trigger: 'item',
        extraCssText: TT_CSS,
        formatter: (p: any) => {
          const a = annotations[p?.dataIndex];
          if (!a) return '';
          return ttHead(t, `${a.n}. ${a.title}`, shortDate(a.date)) + (a.summary ? ttNote(t, a.summary) : '') + (a.url ? ttNote(t, 'Click to open the source ↗') : '');
        },
      },
      series: [
        {
          type: 'scatter',
          symbol: 'circle',
          symbolSize: 17,
          cursor: 'pointer',
          itemStyle: { color: t.text2, borderColor: t.surface, borderWidth: 2 },
          emphasis: { scale: 1.2, itemStyle: { color: t.text } },
          label: { show: true, position: 'inside', formatter: (p: any) => String(annotations[p.dataIndex]?.n ?? ''), color: t.surface, fontFamily: t.mono, fontSize: 9, fontWeight: 600 },
          data: annotations.map((a, i) => [Math.min(xMax, a.x), nRows - 1 - annRows[i]]),
        },
      ],
    }),
    [annotations, annRows, nRows, xMin, xMax],
  );
  const annEvents = useMemo(
    () => ({
      click: (p: any) => {
        const url = annotations[p?.dataIndex]?.url;
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
      },
    }),
    [annotations],
  );

  // ── survival curves ───────────────────────────────────────────────────────
  const realEras = useMemo(() => eras.filter((e) => !e.speculative), [eras]);
  const specEras = useMemo(() => eras.filter((e) => e.speculative), [eras]);
  const e0 = useMemo(() => new Map(eras.map((e) => [e.era, areaE0(e.points)])), [eras]);
  const eraColor = useCallback((e: SurvivalEra, t: Tokens) => (e.speculative ? t.accent : ordinalRamp(realEras.length, t)[realEras.indexOf(e)]), [realEras]);

  const survivalOption = useCallback(
    (t: Tokens): EChartsOption => ({
      grid: { left: 48, right: 24, top: 24, bottom: 34 },
      xAxis: { type: 'value', min: 0, max: Math.max(100, ...eras.flatMap((e) => e.points.map((p) => p[0]))), name: 'age', nameLocation: 'end', nameGap: 6, splitLine: { show: false } },
      yAxis: { type: 'value', min: 0, max: 100, interval: 25, axisLabel: { formatter: '{value}%' } },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: t.line2 } },
        extraCssText: TT_CSS,
        formatter: (ps: any) => {
          const list = Array.isArray(ps) ? ps : [ps];
          const age = Number(list[0]?.axisValue);
          let html = ttHead(t, `Age ${Math.round(age)}`, 'share of births still alive');
          for (const e of [...eras].reverse()) {
            const p = nearest(e.points, age);
            if (p) html += ttRow(t, eraColor(e, t), e.speculative ? `${e.era} (speculative)` : e.era, `${p[1].toFixed(1)}%`, { dashed: e.speculative });
          }
          return html;
        },
      },
      series: [
        ...eras.map((e) => {
          const med = medianAge(e.points);
          const i = realEras.indexOf(e);
          return {
            type: 'line',
            name: e.era,
            data: e.points,
            smooth: 0.18,
            showSymbol: false,
            lineStyle: { width: 2, color: eraColor(e, t), type: e.speculative ? [6, 4] : 'solid' },
            itemStyle: { color: eraColor(e, t) },
            emphasis: { focus: 'series', lineStyle: { width: 3 } },
            // Selective direct label: where each era crosses 50% (the median age at death).
            markPoint:
              med != null
                ? {
                    symbol: 'circle',
                    symbolSize: 8,
                    itemStyle: { color: eraColor(e, t), borderColor: t.surface, borderWidth: 2 },
                    label: { show: true, position: i % 2 ? 'bottom' : 'top', distance: 6, formatter: e.speculative ? 'LEV world' : e.era, color: t.text2, fontFamily: t.mono, fontSize: 10 },
                    data: [{ coord: [med, 50] }],
                  }
                : undefined,
          };
        }),
        {
          type: 'line',
          name: '__half',
          data: [],
          silent: true,
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: t.line2, width: 1, type: 'solid' },
            label: { formatter: 'half the cohort', position: 'insideStartTop', color: t.text3, fontFamily: t.mono, fontSize: 10 },
            data: [{ yAxis: 50 }],
          },
        },
      ] as any[],
    }),
    [eras, realEras, eraColor],
  );

  // ── de Grey Fig. 1, real-data version: remaining life expectancy of fixed cohorts over calendar time ──
  const cohort = lev?.curve?.cohort ?? null;
  const cohortOption = useCallback(
    (t: Tokens): EChartsOption => {
      if (!cohort) return {};
      const ramp = ordinalRamp(cohort.cohorts.length, t);
      const series: any[] = [];
      cohort.cohorts.forEach((k, i) => {
        const c = ramp[i];
        const stack = `band${k.age}`;
        const np = new Map(k.noProgress);
        const common = { type: 'line', showSymbol: false, smooth: 0.2, silent: true, lineStyle: { width: 0 }, tooltip: { show: false } };
        // Shaded gap = years of remaining life banked by progress since the base year.
        series.push({ ...common, name: `__lo${k.age}`, stack, data: k.actual.map(([y]) => [y, np.get(y) ?? null]) });
        series.push({ ...common, name: `__hi${k.age}`, stack, areaStyle: { color: alpha(c, 0.14) }, data: k.actual.map(([y, v]) => [y, np.has(y) ? v - np.get(y)! : null]) });
        series.push({
          type: 'line',
          name: `Aged ${k.age} in ${cohort.baseYear}`,
          data: k.actual,
          smooth: 0.2,
          showSymbol: false,
          symbolSize: 8,
          lineStyle: { width: 2, color: c },
          itemStyle: { color: c, borderColor: t.surface, borderWidth: 2 },
          emphasis: { focus: 'series' },
          endLabel: { show: true, formatter: `age ${k.age} in ${cohort.baseYear}`, color: t.text2, fontFamily: t.mono, fontSize: 10, distance: 6 },
        });
        series.push({
          type: 'line',
          name: `__np${k.age}`,
          data: k.noProgress,
          smooth: 0.2,
          showSymbol: false,
          lineStyle: { width: 1.5, color: c, type: [5, 4], opacity: 0.8 },
          itemStyle: { color: c },
          silent: true,
        });
      });
      return {
        grid: { left: 48, right: 104, top: 24, bottom: 34 },
        xAxis: { type: 'value', min: cohort.baseYear, max: Math.max(...cohort.cohorts.flatMap((k) => k.actual.map((p) => p[0]))), splitLine: { show: false }, axisLabel: { formatter: (v: number) => String(v) } },
        yAxis: { type: 'value', min: 0, name: 'remaining years', nameLocation: 'end', nameGap: 10, nameTextStyle: { align: 'left' } },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'line', lineStyle: { color: t.line2 } },
          extraCssText: TT_CSS,
          formatter: (ps: any) => {
            const list = Array.isArray(ps) ? ps : [ps];
            const yr = Math.round(Number(list[0]?.axisValue));
            let html = ttHead(t, String(yr), 'remaining life expectancy');
            cohort.cohorts.forEach((k, i) => {
              const a = k.actual.find((p) => p[0] === yr);
              const n = k.noProgress.find((p) => p[0] === yr);
              if (!a) return;
              html += ttRow(t, ramp[i], `aged ${k.age} in ${cohort.baseYear} (now ${k.age + yr - cohort.baseYear})`, `${a[1].toFixed(1)} y`);
              if (n) html += ttRow(t, ramp[i], `  if no progress since ${cohort.baseYear}`, `${n[1].toFixed(1)} y`, { dashed: true, muted: true });
            });
            return html;
          },
        },
        series,
      } as EChartsOption;
    },
    [cohort],
  );

  // ── hero numbers ──────────────────────────────────────────────────────────
  const recordSlope = useMemo(() => {
    if (!le?.record.size) return null;
    const pts = [...le.record].map(([y, r]) => [y, r.v] as [number, number]);
    const recent = pts.filter(([y]) => y >= 1990);
    return { all: olsSlope(pts), recent: olsSlope(recent), from: Math.min(...pts.map((p) => p[0])), to: Math.max(...pts.map((p) => p[0])) };
  }, [le]);
  const lastRecordGain = recordGain.at(-1) ?? null;
  const survivalGain = useMemo(() => {
    const dated = realEras.map((e) => ({ e, yr: e.order, a: e0.get(e.era) })).filter((x) => x.a != null && x.yr < 1e4);
    if (dated.length < 2) return null;
    const [p, q] = dated.slice(-2);
    return { rate: (q.a! - p.a!) / (q.yr - p.yr), from: p.e.era, to: q.e.era };
  }, [realEras, e0]);
  const rate = recordSlope?.all ?? survivalGain?.rate ?? null;
  const e65 = lev?.curve?.e65Slopes ?? [];
  const firstMeta = lev?.metaculusHistory[0];

  // ── tables ────────────────────────────────────────────────────────────────
  const gainRows = useMemo(() => {
    const years = new Set<number>();
    if (showRecord) recordGain.forEach(([y]) => years.add(y));
    countryGain.forEach((s) => s.forEach(([y]) => years.add(y)));
    return [...years]
      .filter((y) => y >= xMin && y <= xMax)
      .sort((a, b) => b - a)
      .map((y) => ({ y }));
  }, [recordGain, countryGain, showRecord, xMin, xMax]);
  const gainCols = useMemo<Col<{ y: number }>[]>(() => {
    const rg = new Map(recordGain);
    const cg = new Map([...countryGain].map(([c, s]) => [c, new Map(s)]));
    return [
      { key: 'y', label: 'Year', sort: (r) => r.y, text: (r) => String(r.y), render: (r) => <span className="font-mono text-ink">{r.y}</span> },
      ...(showRecord
        ? [
            {
              key: 'record',
              label: 'Record (holder)',
              align: 'right' as const,
              sort: (r: { y: number }) => rg.get(r.y) ?? null,
              text: (r: { y: number }) => le?.record.get(r.y)?.holder,
              render: (r: { y: number }) => (rg.has(r.y) ? `${fmtRate(rg.get(r.y)!)} (${le?.record.get(r.y)?.holder ?? '?'})` : '—'),
            },
          ]
        : []),
      ...countries.map((c): Col<{ y: number }> => ({ key: c, label: c, align: 'right', sort: (r) => cg.get(c)?.get(r.y) ?? null, render: (r) => (cg.get(c)?.has(r.y) ? fmtRate(cg.get(c)!.get(r.y)!) : '—') })),
    ];
  }, [recordGain, countryGain, countries, le, showRecord]);

  const ages = useMemo(() => [...new Set(eras.flatMap((e) => e.points.map((p) => p[0])))].sort((a, b) => a - b), [eras]);
  const survCols = useMemo<Col<{ age: number }>[]>(
    () => [
      { key: 'age', label: 'Age', sort: (r) => r.age, text: (r) => String(r.age), render: (r) => <span className="font-mono text-ink">{r.age}</span> },
      ...eras.map((e): Col<{ age: number }> => {
        const m = new Map(e.points);
        return { key: e.era, label: e.speculative ? `${e.era}*` : e.era, align: 'right', sort: (r) => m.get(r.age) ?? null, render: (r) => (m.has(r.age) ? `${m.get(r.age)!.toFixed(1)}%` : '—') };
      }),
    ],
    [eras],
  );

  // ── filter row ────────────────────────────────────────────────────────────
  const countryOpts = useMemo<Option[]>(
    () => countryOptions.map((c) => ({ value: c, label: c, color: color(c, t), glyph: '━', count: le?.remaining.get(c)?.size })),
    [countryOptions, color, t, le],
  );
  const sourceOpts = useMemo<Option[]>(() => {
    const n = countBy(allForecasts, (f) => f.source);
    return [...n.keys()].map((src) => ({ value: src, label: src, count: n.get(src), glyph: '◇', color: 'var(--text-2)', hint: allMarked.some((f) => f.source === src) ? undefined : 'no year' }));
  }, [allForecasts, allMarked]);
  const pills = compact([
    picked.length > 0 && { key: 'countries', label: `Countries: ${listSummary(picked, (c) => c)}`, onClear: () => setPicked([]) },
    rangePill('years', 'Years', years, yearDomain, String, () => setYears({})),
    sources.length > 0 && { key: 'sources', label: `Forecasters: ${listSummary(sources, (x) => x)}`, onClear: () => setSources([]) },
    hideForecasts && { key: 'hide', label: 'Forecasts hidden', onClear: () => setHideForecasts(false) },
  ]);

  // ── render ────────────────────────────────────────────────────────────────
  const gainsReady = !!le || allMarked.length > 0;
  const curveTitle = curve === 'survival' ? 'Survival curves by era' : `Remaining life expectancy by cohort · ${cohortCountry(cohort?.method)}`;

  return (
    <Panel
      kicker="Longevity · escape velocity"
      title="Longevity escape velocity"
      actions={
        <>
          {le && (
            <>
              <Segmented
                label="Life expectancy measured"
                options={[
                  { value: 'e0', label: 'At birth', title: 'Life expectancy at birth (e₀)' },
                  { value: 'e65', label: 'At 65', title: 'Remaining life expectancy at 65 (e₆₅)' },
                ]}
                value={metric}
                onChange={setMetric}
              />
            </>
          )}
          <Segmented
            label="Chart or table"
            options={[
              { value: 'chart', label: 'Chart' },
              { value: 'table', label: 'Table' },
            ]}
            value={view}
            onChange={setView}
          />
        </>
      }
      footer={<LevFooter lev={lev} eras={eras} sources={le?.sources ?? {}} />}
    >
      <HeroRow>
        <HeroStat
          i={0}
          label="Metaculus · LEV median"
          value={metaculus?.median != null ? String(Math.floor(metaculus.median)) : '—'}
          sub={
            metaculus ? (
              <ExtLink href={metaculus.url}>
                {metaculus.low != null && metaculus.high != null ? `IQR ${yearLabel(metaculus.low).slice(0, 4)}–${yearLabel(metaculus.high).slice(0, 4)}` : 'community'}
                {firstMeta ? ` · was ${Math.floor(firstMeta.median)} in ${firstMeta.date.slice(0, 4)}` : ''}
                {metaculus.forecasters ? ` · ${metaculus.forecasters} forecasters` : ''}
              </ExtLink>
            ) : lev ? (
              'No Metaculus forecast in lev.yaml'
            ) : (
              'Needs data/curated/lev.yaml'
            )
          }
        />
        {recordSlope?.all != null ? (
          <HeroStat
            i={1}
            label="Record life-expectancy gain"
            value={<CountUp value={recordSlope.all} format={(v) => `${fmtRate(v)} y/y`} />}
            sub={`OLS ${recordSlope.from}–${recordSlope.to}${recordSlope.recent != null ? ` · since 1990 ${fmtRate(recordSlope.recent)}` : ''}${lastRecordGain ? ` · last 5 yrs ${fmtRate(lastRecordGain[1])}` : ''}`}
          />
        ) : survivalGain ? (
          <HeroStat i={1} label="LE gain (survival data)" value={<CountUp value={survivalGain.rate} format={(v) => `${fmtRate(v)} y/y`} />} sub={`${survivalGain.from}→${survivalGain.to}, from curve areas`} />
        ) : (
          <HeroStat i={1} label="Record life-expectancy gain" value="—" sub="Needs life-expectancy data" />
        )}
        <HeroStat
          i={2}
          label="Gap to escape velocity"
          value={rate != null ? <CountUp value={1 - rate} format={(v) => `${v.toFixed(2)} y/y`} /> : '—'}
          sub={
            rate != null && rate > 0
              ? `≈${(1 / rate).toFixed(0)}× the record pace needed${e65.length ? ` · at 65 today: ${Math.min(...e65.map((s) => s.slope)).toFixed(2)}–${Math.max(...e65.map((s) => s.slope)).toFixed(2)} y/y` : ''}`
              : 'LEV = remaining life expectancy rising ≥ 1 year per year'
          }
          info={
            <InfoTip align="right">
              {lev?.definition ?? 'LEV is reached when remaining life expectancy rises by at least one year per calendar year.'} The record line is life expectancy at birth; LEV is
              defined on remaining life expectancy at every age, which rises more slowly at older ages{e65.length ? ` (e₆₅ slopes: ${e65.map((s) => `${s.country} ${s.slope.toFixed(3)}`).join(', ')})` : ''}.
            </InfoTip>
          }
        />
      </HeroRow>

      <FilterRow pills={pills} onClearAll={clearFilters} count={marked.length} total={allMarked.length} noun="forecasts on the chart" className="mb-4">
        {le && <MultiSelect label="Countries" options={countryOpts} value={picked} onChange={setPicked} width={260} />}
        <RangeFilter label="Years" domain={yearDomain} value={years} onChange={setYears} step={1} />
        {allForecasts.length > 0 && <MultiSelect label="Forecasters" options={sourceOpts} value={sources} onChange={setSources} width={280} />}
        {allForecasts.length > 0 && <ToggleFilter label="Hide forecasts" value={hideForecasts} onChange={setHideForecasts} title="Hide every forecast marker and the forecast table" />}
      </FilterRow>

      <Swap k={view}>
        {view === 'chart' ? (
          <div className="@container">
            <div className="grid gap-8 @4xl:grid-cols-[1.3fr_1fr]">
              {/* (a) gains per calendar year vs the 1.0 threshold */}
              <section className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <div className="kicker">Life expectancy gained per calendar year · {METRIC_LABEL[metric]}</div>
                  <InfoTip align="left">
                    Each line is the 5-year rolling mean of how many years of life expectancy were added per calendar year. Escape velocity needs 1.0 or more, sustained, in
                    remaining life expectancy at every age. Post-war spikes above 1.0 at birth (Japan, South Korea) came from falling child and wartime mortality, not from
                    slowing ageing, which is why the “At 65” view matters: there the gains have never come close.
                  </InfoTip>
                </div>
                {!gainsReady ? (
                  <EmptyState title="No LEV data yet" file="data/curated/lev.yaml" h={320} />
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                      {showRecord && <Legend items={[{ label: 'Record (female, best country)', color: color('record', t), glyph: '━' }]} />}
                      {countries.length > 0 && <Legend items={countries.map((c) => ({ label: c, color: color(c, t), glyph: '━' }))} />}
                      <Legend
                        items={[
                          { label: 'Escape velocity', color: t.accent, dashed: true },
                          ...(marked.length ? [{ label: 'Forecast (latest per forecaster)', color: t.text, glyph: '◇' }] : []),
                        ]}
                      />
                    </div>
                    {metric === 'e65' && recordGain.length > 0 && <div className="mb-1 text-[11.5px] text-ink-3">The record series exists only at birth, so it is hidden at 65.</div>}
                    <EChart option={gainsOption} height={330} ariaLabel="Life-expectancy gain per calendar year versus the escape-velocity threshold" />
                    {annotations.length > 0 && (
                      <>
                        <div className="kicker mb-0.5 mt-1 flex items-center gap-2">
                          AI × bio milestones
                          <span className="normal-case tracking-normal text-ink-3">hover or click a number</span>
                        </div>
                        <EChart option={annOption} onEvents={annEvents} height={18 + nRows * 20} ariaLabel="AI-bio milestones along the same timeline" />
                        <ol className="mt-2 grid grid-cols-1 max-h-44 gap-x-5 gap-y-1 overflow-y-auto pr-1 text-[12px] text-ink-2 sm:grid-cols-2">
                          {annotations.map((a) => (
                            <li key={a.n} className="flex min-w-0 items-baseline gap-2">
                              <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-ink-2 font-mono text-[9px] font-semibold text-[var(--surface)]">{a.n}</span>
                              <span className="min-w-0 truncate" title={a.summary ?? a.title}>
                                <span className="font-mono text-ink-3">{a.date.slice(0, 7)}</span> <ExtLink href={a.url}>{a.title}</ExtLink>
                              </span>
                            </li>
                          ))}
                        </ol>
                      </>
                    )}
                    {!le && (
                      <div className="mt-3">
                        <Notice>
                          Life-expectancy series not fetched yet (<code className="font-mono">data/raw/owid-life-expectancy.json</code>), so only the threshold and forecasts are
                          shown.
                          {lev?.lifeExpectancyUrls.length ? <> Sources listed in lev.yaml: {lev.lifeExpectancyUrls.slice(0, 3).map(hostOf).join(', ')}.</> : null}
                        </Notice>
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* (b) the "top-to-bottom" curve */}
              <section className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="kicker truncate">{curveTitle}</div>
                    {curve === 'survival' ? (
                      <InfoTip align="right">
                        Each line follows a group of newborns and shows what share is still alive at each age: the curve that runs “from top to bottom”. In 1851 deaths came
                        at every age, so it sagged like a slope. As infant and mid-life deaths fell, most people now survive into old age and die within a narrow band, so the
                        curve squares off (“rectangularization”). The area under the curve is life expectancy. LEV would push the right-hand cliff outward faster than time
                        passes, so the rectangle keeps stretching rather than just getting squarer.
                      </InfoTip>
                    ) : (
                      <InfoTip align="right">
                        A real-data version of de Grey’s 2004 “escape velocity” figure. Each solid line follows people of one age in {cohort?.baseYear} through later life
                        tables; the dashed line is what they would have faced with no medical progress since {cohort?.baseYear}. The shaded gap is time already banked. In
                        de Grey’s concept, younger cohorts’ lines bottom out and turn upward: that upturn is LEV. In the data every line still falls.
                      </InfoTip>
                    )}
                  </div>
                  {cohort && eras.length > 0 && (
                    <Segmented
                      label="Curve"
                      options={[
                        { value: 'survival', label: 'Survival', title: 'Share of births alive at each age, by era' },
                        { value: 'cohort', label: 'Cohorts', title: 'de Grey 2004 Fig. 1, real data' },
                      ]}
                      value={curve}
                      onChange={setCurve}
                    />
                  )}
                </div>
                {curve === 'survival' || !cohort ? (
                  eras.length ? (
                    <>
                      <div className="mb-2">
                        <Legend
                          items={[
                            ...realEras.map((e) => ({ label: e0.get(e.era) != null ? `${e.era} · e₀≈${e0.get(e.era)!.toFixed(0)}` : e.era, color: eraColor(e, t), glyph: '━' })),
                            ...specEras.map((e) => ({ label: `${e.era} (speculative)`, color: t.accent, dashed: true })),
                          ]}
                        />
                      </div>
                      <EChart option={survivalOption} height={330} ariaLabel="Share of a birth cohort surviving to each age, by era" />
                      <p className="mt-1 text-[11.5px] text-ink-3">England &amp; Wales period life tables. e₀≈ is the area under each curve (approximate, 5-year steps).</p>
                    </>
                  ) : (
                    <EmptyState title="No survival curves yet" file="data/curated/survival-curves.csv" h={330} />
                  )
                ) : (
                  <>
                    <div className="mb-2">
                      <Legend
                        items={[
                          { label: 'Actual (later life tables)', color: t.text2, glyph: '━' },
                          { label: `If no progress since ${cohort.baseYear}`, color: t.text2, dashed: true },
                        ]}
                      />
                    </div>
                    <EChart option={cohortOption} height={330} ariaLabel="Remaining life expectancy of fixed cohorts over calendar time" />
                    <p className="mt-1 text-[11.5px] text-ink-3">Shaded = remaining years banked by progress. LEV would show as a line that stops falling.</p>
                  </>
                )}
                <CurveNote lev={lev} onCohort={cohort && curve !== 'cohort' ? () => setCurve('cohort') : undefined} />
              </section>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {gainRows.length ? (
              <div>
                <div className="kicker mb-2">Life expectancy gained per year {METRIC_LABEL[metric]} · 5-yr rolling mean</div>
                <SortTable cols={gainCols} rows={gainRows} rowKey={(r) => String(r.y)} initial={{ key: 'y', dir: 'desc' }} maxH={300} caption="Life expectancy gain per year" />
              </div>
            ) : (
              <Notice>No life-expectancy series yet (data/raw/owid-life-expectancy.json).</Notice>
            )}
            {forecasts.length > 0 && <ForecastTable forecasts={forecasts} />}
            {allForecasts.length > 0 && !forecasts.length && (
              <FilterEmpty onClear={clearFilters} h={120}>
                No forecasts match these filters.
              </FilterEmpty>
            )}
            {(lev?.manifold.length ?? 0) > 0 && <ManifoldTable markets={lev!.manifold} />}
            {eras.length > 0 && (
              <div>
                <div className="kicker mb-2">Survival curves · % of births alive at each age</div>
                <SortTable cols={survCols} rows={ages.map((age) => ({ age }))} rowKey={(r) => String(r.age)} initial={{ key: 'age', dir: 'asc' }} maxH={300} caption="Survival curves" />
              </div>
            )}
            {cohort && <CohortTable cohort={cohort} />}
          </div>
        )}
      </Swap>
    </Panel>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────
function nearest(points: [number, number][], x: number) {
  let best: [number, number] | null = null;
  for (const p of points) if (!best || Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
  return best && Math.abs(best[0] - x) <= 3 ? best : null;
}

const cohortCountry = (method: string | null | undefined) => (method ? (/^([A-Z][A-Za-z .&]+?),/.exec(method)?.[1] ?? 'HMD') : 'HMD');

function ForecastTable({ forecasts }: { forecasts: LevForecast[] }) {
  const cols: Col<LevForecast>[] = [
    { key: 'source', label: 'Forecaster', sort: (f) => f.source, text: (f) => f.note, render: (f) => <ExtLink href={f.url}>{f.source}</ExtLink> },
    { key: 'label', label: 'LEV year', align: 'right', sort: (f) => f.median ?? f.low, render: (f) => <span className="font-semibold text-ink">{f.label}</span> },
    {
      key: 'range',
      label: 'Range',
      align: 'right',
      sort: (f) => f.low,
      render: (f) => (f.rangeKind === 'iqr' && f.low != null && f.high != null ? `IQR ${yearLabel(f.low).slice(0, 4)}–${yearLabel(f.high).slice(0, 4)}` : '—'),
    },
    { key: 'p', label: 'Prob.', align: 'right', sort: (f) => f.probability, render: (f) => (f.probability != null ? `${f.probability}%` : '—') },
    { key: 'published', label: 'Stated', sort: (f) => f.published, render: (f) => (f.published ? <span className="whitespace-nowrap font-mono">{f.published}</span> : '—') },
    { key: 'note', label: 'Claim', render: (f) => <span className="block min-w-[260px] text-ink-3">{f.note ?? ''}</span> },
  ];
  return (
    <div>
      <div className="kicker mb-2">LEV forecasts · every statement</div>
      <SortTable cols={cols} rows={forecasts} rowKey={(f) => f.id} initial={{ key: 'published', dir: 'desc' }} caption="LEV forecasts" />
    </div>
  );
}

function ManifoldTable({ markets }: { markets: ManifoldMarket[] }) {
  const cols: Col<ManifoldMarket>[] = [
    { key: 'q', label: 'Manifold market', sort: (m) => m.question, render: (m) => <span className="block min-w-[260px]"><ExtLink href={m.url}>{m.question}</ExtLink></span> },
    {
      key: 'p',
      label: 'Prob.',
      align: 'right',
      sort: (m) => m.probability,
      render: (m) => (m.resolved ? `resolved ${m.resolution ?? ''}` : m.probability != null ? `${m.probability}%` : '—'),
    },
    { key: 'b', label: 'Bettors', align: 'right', sort: (m) => m.bettors, render: (m) => m.bettors ?? '—' },
    { key: 'c', label: 'Closes', sort: (m) => m.closes, render: (m) => <span className="font-mono">{m.closes ?? '—'}</span> },
    { key: 'n', label: 'Note', render: (m) => <span className="text-ink-3">{m.note ?? ''}</span> },
  ];
  return (
    <div>
      <div className="kicker mb-2">Prediction markets (thin; context only)</div>
      <SortTable cols={cols} rows={markets} rowKey={(m) => m.question} initial={{ key: 'b', dir: 'desc' }} maxH={300} caption="Manifold markets" />
    </div>
  );
}

function CohortTable({ cohort }: { cohort: NonNullable<NonNullable<LevModel['curve']>['cohort']> }) {
  const years = [...new Set(cohort.cohorts.flatMap((k) => k.actual.map((p) => p[0])))].sort((a, b) => a - b);
  const cols: Col<{ y: number }>[] = [
    { key: 'y', label: 'Year', sort: (r) => r.y, render: (r) => <span className="font-mono text-ink">{r.y}</span> },
    ...cohort.cohorts.flatMap((k): Col<{ y: number }>[] => {
      const a = new Map(k.actual);
      const n = new Map(k.noProgress);
      return [
        { key: `a${k.age}`, label: `Age ${k.age} actual`, align: 'right', sort: (r) => a.get(r.y) ?? null, render: (r) => (a.has(r.y) ? a.get(r.y)!.toFixed(2) : '—') },
        { key: `n${k.age}`, label: 'no progress', align: 'right', sort: (r) => n.get(r.y) ?? null, render: (r) => <span className="text-ink-3">{n.has(r.y) ? n.get(r.y)!.toFixed(2) : '—'}</span> },
      ];
    }),
  ];
  return (
    <div>
      <div className="kicker mb-2">Remaining life expectancy of cohorts (years) · {cohortCountry(cohort.method)}</div>
      <SortTable cols={cols} rows={years.map((y) => ({ y }))} rowKey={(r) => String(r.y)} initial={{ key: 'y', dir: 'asc' }} caption="Cohort remaining life expectancy" />
      {cohort.method && <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">{cohort.method}</p>}
    </div>
  );
}

function CurveNote({ lev, onCohort }: { lev: LevModel | null; onCohort?: () => void }) {
  const c = lev?.curve;
  if (!c?.bestGuess) return null;
  return (
    <details className="group mt-3 rounded-xl border border-line bg-surface-2/50 px-3 py-2 text-[12px] leading-relaxed text-ink-3">
      <summary className="cursor-pointer list-none text-ink-2">
        <span className="kicker mr-2">Which curve?</span>
        Best guess: <ExtLink href={c.bestGuessUrl}>{c.bestGuess}</ExtLink>
        {onCohort && (
          <>
            {' · '}
            <button className="underline decoration-line-2 underline-offset-2 hover:text-ink" onClick={(e) => (e.preventDefault(), onCohort())}>
              see the real-data version
            </button>
          </>
        )}
        <span className="ml-1 text-ink-3 group-open:hidden">▾</span>
      </summary>
      {c.note && <p className="mt-2">{c.note}</p>}
      {c.candidates.length > 1 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4">
          {c.candidates.map((x) => (
            <li key={x.id}>
              <ExtLink href={x.url}>{x.name}</ExtLink>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function LevFooter({ lev, eras, sources }: { lev: LevModel | null; eras: SurvivalEra[]; sources: Record<string, string> }) {
  const srcs = [...new Set(eras.map((e) => e.source).filter((s): s is string => !!s && s.startsWith('http')))];
  const links = [...Object.values(sources), ...srcs];
  return (
    <span>
      Gains = (LE[y] − LE[y−5]) ÷ 5. Forecasts, milestones and cohort data: <code className="font-mono">data/curated/lev.yaml</code>
      {lev ? '' : ' (missing)'}. Survival curves: <code className="font-mono">survival-curves.csv</code>.
      {links.length > 0 && (
        <>
          {' '}
          Data:{' '}
          {links.map((u, i) => (
            <span key={u}>
              {i > 0 && ', '}
              <ExtLink href={u}>{hostOf(u)}</ExtLink>
            </span>
          ))}
          .
        </>
      )}
    </span>
  );
}
