import type { EChartsOption } from 'echarts';
import { BarChart, CustomChart, LineChart, LinesChart, ScatterChart } from 'echarts/charts';
import {
  AriaComponent,
  AxisPointerComponent,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

// Register only what the dashboard uses (keeps ~600 kB of ECharts out of the bundle).
echarts.use([
  BarChart,
  CustomChart,
  LineChart,
  LinesChart,
  ScatterChart,
  AriaComponent,
  AxisPointerComponent,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
]);
import { useTokens, type Tokens } from '../lib/tokens.ts';

type Option = EChartsOption;

interface Props {
  /** Build the option from resolved theme tokens so colours follow light/dark. */
  option: (t: Tokens) => Option | Record<string, any>;
  height?: number | string;
  className?: string;
  onEvents?: Record<string, (params: any, chart: echarts.ECharts) => void>;
  ariaLabel?: string;
}

/** Thin ECharts wrapper: owns init/dispose/resize and re-renders on theme change. */
export function EChart({ option, height = 360, className = '', onEvents, ariaLabel }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const tokens = useTokens();

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.setOption(withBase(option(tokens) as Option, tokens), { notMerge: true, lazyUpdate: true });
  }, [option, tokens]);

  useEffect(() => {
    const c = chart.current;
    if (!c || !onEvents) return;
    const entries = Object.entries(onEvents);
    for (const [ev, fn] of entries) c.on(ev, (p: any) => fn(p, c));
    return () => {
      for (const [ev] of entries) c.off(ev);
    };
  }, [onEvents]);

  return <div ref={el} role="img" aria-label={ariaLabel} className={className} style={{ height, width: '100%' }} />;
}

/** Shared chrome: hairline axes, recessive grid, token-driven tooltip, Geist type. */
function withBase(o: Option, t: Tokens): Option {
  const axis = (a: any) =>
    a && {
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: { color: t.text3, fontFamily: t.mono, fontSize: 10.5 },
      splitLine: { lineStyle: { color: t.grid, width: 1 } },
      nameTextStyle: { color: t.text3, fontFamily: t.mono, fontSize: 10.5 },
      ...a,
    };
  const mapAxis = (a: any) => (Array.isArray(a) ? a.map(axis) : axis(a));
  return {
    backgroundColor: 'transparent',
    animationDuration: 700,
    animationEasing: 'cubicOut',
    textStyle: { fontFamily: t.font, color: t.text2 },
    grid: { left: 52, right: 24, top: 28, bottom: 40, containLabel: false, ...(o.grid as object) },
    ...o,
    xAxis: mapAxis(o.xAxis),
    yAxis: mapAxis(o.yAxis),
    tooltip: o.tooltip && {
      backgroundColor: t.surface2,
      borderColor: t.line2,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: t.text, fontFamily: t.font, fontSize: 12 },
      extraCssText: 'border-radius:12px;box-shadow:0 12px 32px -12px rgba(0,0,0,.5);backdrop-filter:blur(8px);',
      ...(o.tooltip as object),
    },
    legend: o.legend && {
      textStyle: { color: t.text2, fontFamily: t.font, fontSize: 12 },
      inactiveColor: t.text3,
      itemWidth: 10,
      itemHeight: 10,
      icon: 'circle',
      ...(o.legend as object),
    },
  } as Option;
}
