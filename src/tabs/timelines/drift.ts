// Pure model + ECharts option for the forecast-drift chart (x = published, y = median date).
import type { EChartsOption } from 'echarts';
import { monthYear, shortDate, toTime } from '../../lib/format.ts';
import type { Tokens } from '../../lib/tokens.ts';
import { forecasterMarks, MILESTONE_KEYS, MILESTONE_META, milestoneKey, type ForecasterMark, type MilestoneKey } from './forecasts.ts';
import type { ForecastUpdate } from './types.ts';

export const YEAR_MS = 365.2425 * 864e5;

export type DriftRow = ForecastUpdate & { key: MilestoneKey | null };
export interface DriftModel {
  rows: DriftRow[];
  charted: (DriftRow & { key: MilestoneKey })[];
  keys: MilestoneKey[];
  forecasters: string[];
  marks: Map<string, ForecasterMark>;
}

export function buildDriftModel(updates: ForecastUpdate[]): DriftModel {
  const rows = updates
    .map((u) => ({ ...u, key: milestoneKey(u.milestone) }))
    .sort((a, b) => (a.key ?? 'z').localeCompare(b.key ?? 'z') || a.forecaster.localeCompare(b.forecaster) || a.published.localeCompare(b.published));
  const charted = rows.filter((r): r is DriftRow & { key: MilestoneKey } => r.key !== null);
  const marks = forecasterMarks(charted.map((r) => r.forecaster));
  return { rows, charted, keys: MILESTONE_KEYS.filter((k) => charted.some((r) => r.key === k)), forecasters: [...marks.keys()], marks };
}

export const yearsOut = (r: ForecastUpdate) => (toTime(r.median) - toTime(r.published)) / YEAR_MS;

export function driftOption(m: DriftModel, t: Tokens, colorOf: (k: MilestoneKey) => string, now: string): EChartsOption {
  const series: any[] = [];
  for (const k of m.keys)
    for (const f of m.forecasters) {
      const pts = m.charted.filter((r) => r.key === k && r.forecaster === f);
      if (!pts.length) continue;
      const mk = m.marks.get(f)!;
      series.push({
        name: `${MILESTONE_META[k].short} · ${f}`,
        type: 'line',
        data: pts.map((r) => ({ value: [toTime(r.published), toTime(r.median)], row: r })),
        symbol: mk.symbol,
        symbolSize: 9,
        lineStyle: { color: colorOf(k), width: 2, type: mk.line },
        itemStyle: { color: colorOf(k), borderColor: t.surface, borderWidth: 2 },
        emphasis: { focus: 'series', lineStyle: { width: 3 } },
        z: 3,
      });
    }
  const xs = m.charted.map((r) => toTime(r.published));
  const ys = m.charted.map((r) => toTime(r.median));
  const nowT = toTime(now);
  const x0 = Math.min(...xs, nowT) - 0.15 * YEAR_MS;
  const x1 = Math.max(...xs, nowT) + 0.15 * YEAR_MS;
  const y0 = Math.min(Math.min(...ys), x0);
  const y1 = Math.max(...ys) + 0.4 * YEAR_MS;
  // y = x: "the forecast date is today". Height above it = how far out the forecast sits.
  const ref = { color: t.text3, fontFamily: t.mono, fontSize: 10 };
  series.push({
    name: 'reference',
    type: 'line',
    data: [],
    silent: true,
    z: 1,
    markLine: {
      silent: true,
      symbol: 'none',
      data: [
        [
          { coord: [x0, x0], lineStyle: { color: t.text3, width: 1, type: 'dotted' }, label: { ...ref, formatter: 'forecast date = today', position: 'insideEndTop' } },
          { coord: [x1, x1] },
        ],
        { xAxis: nowT, lineStyle: { color: t.accent, width: 1, type: 'solid', opacity: 0.7 }, label: { ...ref, formatter: 'now', position: 'end' } },
      ],
    },
  });
  return {
    grid: { left: 60, right: 28, top: 22, bottom: 44 },
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => {
        const r: DriftRow | undefined = p.data?.row;
        if (!r?.key) return '';
        return `<div style="max-width:280px;white-space:normal"><div style="font-weight:600">${MILESTONE_META[r.key].label}</div>
          <div style="color:${t.text2};margin-top:2px">${escapeHtml(r.forecaster)} · published ${shortDate(r.published)}</div>
          <div style="margin-top:6px">median <b>${monthYear(r.median)}</b> <span style="color:${t.text3}">(${yearsOut(r).toFixed(1)} yr out)</span></div>
          ${r.note ? `<div style="color:${t.text3};margin-top:6px;font-size:11px">${escapeHtml(r.note)}</div>` : ''}</div>`;
      },
    },
    xAxis: { type: 'time', min: x0, max: x1, name: 'published', nameLocation: 'middle', nameGap: 28, splitLine: { show: false } },
    yAxis: { type: 'time', min: y0, max: y1, name: 'median date', nameLocation: 'middle', nameGap: 44, axisLabel: { formatter: '{yyyy}' } },
    series,
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
