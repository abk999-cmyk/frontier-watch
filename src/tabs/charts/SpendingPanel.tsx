import type { EChartsOption } from 'echarts';
import { useCallback, useMemo, useState } from 'react';
import { EChart } from '../../charts/EChart.tsx';
import { DateFilter, MultiSelect, RangeFilter, SearchInput, type DatePreset, type Option } from '../../components/filters/Filters.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { InfoTip, Legend } from '../../components/ui/misc.tsx';
import { useCharts } from '../../lib/data.ts';
import { addMonths, ANY_DATE, countBy, matchAny, todayIso, type DateFilterValue } from '../../lib/filters.ts';
import { isoFromTime, shortDate } from '../../lib/format.ts';
import { useTokens, type Tokens } from '../../lib/tokens.ts';
import {
  buildCapexModel,
  CAPEX_COMPANIES,
  impliedFromGuidance,
  modeSeries,
  parseCommitments,
  qKey,
  qLabel,
  qOfDate,
  qStart,
  ttmStat,
  type CapexMode,
  type Commitment,
  type ModeCell,
} from './cbData.ts';
import {
  alpha,
  catPalette,
  CountUp,
  EmptyState,
  esc,
  ExtLink,
  FilterEmpty,
  fmtB,
  fmtPct,
  HeroRow,
  HeroStat,
  Notice,
  SortTable,
  Swap,
  Toggle,
  TT_CSS,
  ttHead,
  ttNote,
  ttRow,
  violet,
  type Col,
} from './cbUi.tsx';
import { FilterRow } from './common.tsx';
import { COMMIT_EMPTY, compact, datePill, filterCommitments, multiPill, numDomain, quarterMatches, rangePill, textPill, type CommitFacet, type CommitFilter } from './filterModel.ts';

type View = 'chart' | 'table';
type SizeBy = 'usd' | 'gw';

/** Both charts share this grid so the commitments strip lines up under the capex bars. */
const GRID_X = { left: 96, right: 28 };
const YEAR_MS = 365.25 * 864e5;
const qMid = (q: number) => (qStart(q) + qStart(q + 1)) / 2;
const TODAY = Date.now();

const MODE_OPTS: { value: CapexMode; label: string; title: string }[] = [
  { value: 'quarterly', label: 'Quarterly', title: 'Capex per calendar quarter' },
  { value: 'annualized', label: 'Annualized', title: 'Trailing four-quarter sum' },
  { value: 'cumulative', label: 'Cumulative', title: 'Running total since the first reported quarter' },
];
const MODE_SUB: Record<CapexMode, string> = {
  quarterly: 'Capex per calendar quarter, $B',
  annualized: 'Trailing four-quarter sum, $B',
  cumulative: 'Running total since each company’s first reported quarter, $B',
};
const STATUS_LABEL: Record<Commitment['status'], string> = {
  contracted: 'Contracted',
  announced: 'Announced',
  revised: 'Revised',
  cancelled: 'Cancelled',
};

/** Display names for commitment lanes (the YAML uses lower-case ids). */
const LANE_NAME: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  xai: 'xAI',
  google: 'Google',
  microsoft: 'Microsoft',
  meta: 'Meta',
  amazon: 'Amazon',
  oracle: 'Oracle',
  other: 'Other',
  Other: 'Other',
};
const laneName = (c: string) => LANE_NAME[c] ?? c;
const STATUS_GLYPH: Record<Commitment['status'], string> = { contracted: '●', announced: '○', revised: '⊘', cancelled: '⊘' };

/** Quarter-window presets, anchored on today. */
function quarterPresets(): DatePreset[] {
  const t = todayIso();
  const y = Number(t.slice(0, 4));
  return [
    { label: 'Last 4 quarters', value: { mode: 'between', from: addMonths(t, -12), to: t } },
    { label: 'Last 8 quarters', value: { mode: 'between', from: addMonths(t, -24), to: t } },
    { label: 'Reported so far', value: { mode: 'before', to: t } },
    { label: 'Guided (ahead)', value: { mode: 'after', from: t } },
    ...[y, y - 1, y - 2].map((yy) => ({ label: String(yy), value: { mode: 'between' as const, from: `${yy}-01-01`, to: `${yy}-12-31` } })),
  ];
}

const companyColor = (c: string, t: Tokens) => {
  const i = (CAPEX_COMPANIES as readonly string[]).indexOf(c);
  return i >= 0 ? catPalette(t)[i] : t.lab.other;
};

/** Year ticks on a time axis, labelled with the bare year. */
const yearAxis = (min: number, max: number, showLabels = true) => ({
  type: 'time' as const,
  min,
  max,
  minInterval: YEAR_MS * 0.98,
  splitLine: { show: false },
  axisLabel: { show: showLabels, formatter: (v: number) => String(new Date(v).getFullYear()), hideOverlap: true },
});

export default function SpendingPanel() {
  const charts = useCharts();
  const t = useTokens();
  const model = useMemo(() => buildCapexModel(charts?.capex), [charts]);
  const commitments = useMemo(() => parseCommitments(charts?.commitments), [charts]);
  const implied = useMemo(() => (model ? impliedFromGuidance(model) : new Map()), [model]);

  const [mode, setMode] = useState<CapexMode>('quarterly');
  const [leases, setLeases] = useState(false);
  const [view, setView] = useState<View>('chart');
  const [sizeBy, setSizeBy] = useState<SizeBy>('usd');

  // ── filters: capex (company, quarter window) and commitments (six facets) ──
  const [capexCos, setCapexCos] = useState<string[]>([]);
  const [capexQ, setCapexQ] = useState<DateFilterValue>(ANY_DATE);
  const [cf, setCf] = useState<CommitFilter>(COMMIT_EMPTY);
  const setC = useCallback(<K extends keyof CommitFilter>(k: K, v: CommitFilter[K]) => setCf((prev) => ({ ...prev, [k]: v })), []);
  const clearCapex = useCallback(() => {
    setCapexCos([]);
    setCapexQ(ANY_DATE);
  }, []);
  const clearCommits = useCallback(() => setCf(COMMIT_EMPTY), []);

  // Capex's own quarter span (reported + guided), before any filter.
  const full = useMemo(() => {
    if (!model) return null;
    let q1 = model.last;
    for (const m of implied.values()) for (const q of m.keys()) q1 = Math.max(q1, q);
    return { q0: model.first, q1 };
  }, [model, implied]);
  const companies = useMemo(() => (model ? model.companies.filter((c) => matchAny(c, capexCos)) : []), [model, capexCos]);
  const capexQuarters = useMemo(() => {
    if (!model || !full) return [];
    const out: number[] = [];
    for (let q = full.q0; q <= full.q1; q++) if (quarterMatches(q, capexQ) && companies.some((c) => model.actual.get(c)?.has(q) || implied.get(c)?.has(q))) out.push(q);
    return out;
  }, [model, full, capexQ, companies, implied]);
  const commitsShown = useMemo(() => filterCommitments(commitments, cf), [commitments, cf]);

  // Shared quarter range: filtered capex quarters ∪ filtered commitments, so the strip stays aligned under the bars.
  const range = useMemo(() => {
    let q0 = Infinity;
    let q1 = -Infinity;
    if (capexQuarters.length) {
      q0 = capexQuarters[0];
      q1 = capexQuarters[capexQuarters.length - 1];
    }
    for (const c of commitsShown) {
      q0 = Math.min(q0, qOfDate(c.date));
      q1 = Math.max(q1, qOfDate(c.date));
    }
    return Number.isFinite(q0) ? { q0, q1 } : null;
  }, [capexQuarters, commitsShown]);

  const prep = useMemo(() => {
    if (!model || !range || !full || !capexQuarters.length) return null;
    const { q0, q1 } = range;
    const n = q1 - q0 + 1;
    const keepQ = new Set(capexQuarters);
    // Transform over the company's whole history first (so trailing / cumulative totals stay honest), then mask to the window.
    const cells = companies.map((c) => {
      const whole = modeSeries(full.q0, full.q1, model.actual.get(c), implied.get(c), mode, leases);
      return Array.from({ length: n }, (_, i) => (keepQ.has(q0 + i) ? (whole[q0 + i - full.q0] ?? null) : null));
    });
    const top: number[] = Array(n).fill(-1);
    const totals: (number | null)[] = Array(n).fill(null);
    const ghostAt: boolean[] = Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      cells.forEach((col, ci) => {
        const cell = col[i];
        if (!cell) return;
        top[i] = ci;
        totals[i] = (totals[i] ?? 0) + cell.v;
        if (cell.ghost) ghostAt[i] = true;
      });
    }
    // Direct labels: the latest fully reported bar, and the biggest guided bar.
    let lastSolid = -1;
    let lastGhost = -1;
    totals.forEach((v, i) => {
      if (v == null) return;
      if (!ghostAt[i]) lastSolid = i;
      else if (lastGhost < 0 || v >= totals[lastGhost]!) lastGhost = i;
    });
    return { q0, q1, n, companies, cells, top, totals, ghostAt, lastSolid, lastGhost };
  }, [model, implied, range, full, capexQuarters, companies, mode, leases]);

  const ttm = useMemo(() => (model ? ttmStat(model, leases) : null), [model, leases]);
  // Largest live (not cancelled, not superseded) commitment; ties go to contracted, then the latest.
  const largest = useMemo(() => {
    const live = commitments.filter((c) => c.status !== 'cancelled' && !c.supersededBy);
    const rank = (a: Commitment, b: Commitment, k: 'usdBillions' | 'gigawatts') =>
      b[k]! - a[k]! || Number(b.status === 'contracted') - Number(a.status === 'contracted') || b.t - a.t;
    const withUsd = live.filter((c) => c.usdBillions != null).sort((a, b) => rank(a, b, 'usdBillions'));
    const contracted = withUsd.find((c) => c.status === 'contracted') ?? null;
    if (withUsd.length) return { c: withUsd[0], unit: 'usd' as const, contracted: contracted === withUsd[0] ? null : contracted };
    const withGw = live.filter((c) => c.gigawatts != null).sort((a, b) => rank(a, b, 'gigawatts'));
    return withGw.length ? { c: withGw[0], unit: 'gw' as const, contracted: null } : null;
  }, [commitments]);

  // ── capex chart ───────────────────────────────────────────────────────────
  const capexOption = useCallback(
    (t: Tokens): EChartsOption => {
      if (!model || !prep) return {};
      const { q0, q1, n, cells, top, totals, lastSolid, lastGhost } = prep;
      const xs = Array.from({ length: n }, (_, i) => qMid(q0 + i));
      const series: any[] = [];
      prep.companies.forEach((c, ci) => {
        const color = companyColor(c, t);
        const item = (cell: ModeCell | null, i: number, ghost: boolean) => {
          if (!cell || cell.ghost !== ghost) return [xs[i], '-'];
          const isTop = top[i] === ci;
          const labelled = isTop && (i === lastSolid || i === lastGhost);
          return {
            value: [xs[i], cell.v],
            itemStyle: isTop ? { borderRadius: [4, 4, 0, 0] } : undefined,
            label: labelled
              ? {
                  show: true,
                  position: 'top',
                  distance: 6,
                  formatter: `${ghost ? '≈' : ''}${fmtB(totals[i]!)}`,
                  color: t.text2,
                  fontFamily: t.mono,
                  fontSize: 10.5,
                }
              : undefined,
          };
        };
        const common = { type: 'bar', stack: 'capex', barMaxWidth: 24, barCategoryGap: '28%', emphasis: { focus: 'series' }, blur: { itemStyle: { opacity: 0.35 } } };
        series.push({
          ...common,
          name: c,
          itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
          data: cells[ci].map((cell, i) => item(cell, i, false)),
        });
        series.push({
          ...common,
          name: c,
          itemStyle: { color: alpha(color, 0.13), borderColor: color, borderWidth: 1.5, borderType: [3, 3] },
          data: cells[ci].map((cell, i) => item(cell, i, true)),
        });
      });
      // "today" hairline separates reported quarters from guided ones.
      if (series[0]) {
        series[0].markLine = {
          silent: true,
          symbol: 'none',
          lineStyle: { color: t.line2, width: 1, type: 'solid' },
          label: { formatter: 'today', color: t.text3, fontFamily: t.mono, fontSize: 10, position: 'end' },
          data: [{ xAxis: TODAY }],
        };
      }
      return {
        grid: { ...GRID_X, top: 30, bottom: 30 },
        xAxis: yearAxis(qStart(q0), qStart(q1 + 1)),
        yAxis: { type: 'value', axisLabel: { formatter: (v: number) => (v === 0 ? '0' : `$${v}B`) }, splitNumber: 4 },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'line', lineStyle: { color: t.line2 } },
          extraCssText: TT_CSS,
          formatter: (ps: any) => {
            const p = Array.isArray(ps) ? ps[0] : ps;
            const i = p?.dataIndex;
            if (i == null || totals[i] == null) return '';
            const q = q0 + i;
            let html = ttHead(t, `${qLabel(q).replace("'", '20')}`, MODE_OPTS.find((m) => m.value === mode)!.label.toLowerCase());
            const ghosts: string[] = [];
            for (let ci = prep.companies.length - 1; ci >= 0; ci--) {
              const c = prep.companies[ci];
              const cell = cells[ci][i];
              if (!cell) {
                html += ttRow(t, t.text3, c, 'no data', { muted: true });
                continue;
              }
              html += ttRow(t, companyColor(c, t), cell.ghost ? `${c} · guided` : c, fmtB(cell.v), { dashed: cell.ghost });
              const im = implied.get(c)?.get(q);
              if (im && mode === 'quarterly')
                ghosts.push(
                  `${c}: ${im.guidance.period} guide ${guideRange(im.guidance)} − ${fmtB(im.reportedYtd)} reported, ÷ ${im.open} quarter${im.open > 1 ? 's' : ''} left${im.approx ? ' (reported approximated as capex + finance leases)' : ''}.`,
                );
            }
            html += `<div style="border-top:1px solid ${t.line};margin:4px 0"></div>` + ttRow(t, t.text2, 'Total', fmtB(totals[i]!));
            if (prep.ghostAt[i]) html += ttNote(t, mode === 'quarterly' ? `Dashed = implied by guidance, not reported. ${ghosts.join(' ')}` : 'Includes quarters implied by guidance (dashed), not yet reported.');
            if (mode === 'annualized' && prep.companies.some((_, ci) => !cells[ci][i] && cells[ci].some(Boolean))) html += ttNote(t, 'A company needs four straight quarters of data to show a trailing total.');
            return html;
          },
        },
        series,
      } as EChartsOption;
    },
    [model, prep, implied, mode],
  );

  // ── commitments strip ─────────────────────────────────────────────────────
  const lanes = useMemo(() => {
    const tot = new Map<string, { usd: number; n: number }>();
    for (const c of commitsShown) {
      const x = tot.get(c.company) ?? { usd: 0, n: 0 };
      x.usd += c.usdBillions ?? 0;
      x.n++;
      tot.set(c.company, x);
    }
    const sorted = [...tot.entries()].sort((a, b) => b[1].usd - a[1].usd || b[1].n - a[1].n).map(([c]) => c);
    const keep = sorted.length > 8 ? sorted.slice(0, 7) : sorted;
    const lanes = sorted.length > 8 ? [...keep, 'Other'] : keep;
    return lanes.reverse(); // category axis draws bottom → top; largest on top
  }, [commitsShown]);
  const laneOf = useCallback((c: Commitment) => (lanes.includes(c.company) ? c.company : 'Other'), [lanes]);
  const byId = useMemo(() => new Map(commitments.map((c) => [c.id, c])), [commitments]);

  const stripOption = useCallback(
    (t: Tokens): EChartsOption => {
      if (!range || !commitsShown.length) return {};
      const hue = violet(t);
      const metric = (c: Commitment) => (sizeBy === 'usd' ? c.usdBillions : c.gigawatts);
      // Marker scale from every commitment, so filtering never re-inflates the small ones.
      const max = Math.max(0, ...commitments.map((c) => metric(c) ?? 0));
      const size = (c: Commitment) => {
        const v = metric(c);
        return v == null || max <= 0 ? 7 : Math.max(8, 40 * Math.sqrt(v / max)); // area ∝ value
      };
      const style = (c: Commitment) => {
        if (metric(c) == null) return { color: 'transparent', borderColor: t.text3, borderWidth: 1.5, borderType: [2, 2] };
        switch (c.status) {
          case 'contracted':
            return { color: alpha(hue, 0.9), borderColor: t.surface, borderWidth: 1.5 };
          case 'announced':
            return { color: alpha(hue, 0.08), borderColor: hue, borderWidth: 2 };
          default:
            return { color: alpha(t.text3, 0.1), borderColor: t.text3, borderWidth: 1.5 };
        }
      };
      const shownIds = new Set(commitsShown.map((c) => c.id));
      const marks = commitsShown.map((c) => ({ value: [c.t, laneOf(c)], cid: c.id, symbolSize: size(c), itemStyle: style(c) }));
      const struck = commitsShown
        .filter((c) => c.status === 'revised' || c.status === 'cancelled')
        .map((c) => ({
          value: [c.t, laneOf(c)],
          cid: c.id,
          symbolSize: size(c) + 6,
          label: { show: true, position: 'right', distance: 4, formatter: c.status, color: t.text3, fontFamily: t.mono, fontSize: 10 },
        }));
      const links = commitsShown
        .filter((c) => c.supersededBy && byId.has(c.supersededBy) && shownIds.has(c.supersededBy))
        .map((c) => {
          const to = byId.get(c.supersededBy!)!;
          // lines series take raw axis values: category lanes by index, not name
          return { coords: [[c.t, lanes.indexOf(laneOf(c))], [to.t, lanes.indexOf(laneOf(to))]] };
        });
      return {
        grid: { ...GRID_X, top: 10, bottom: 28 },
        xAxis: yearAxis(qStart(range.q0), qStart(range.q1 + 1)),
        yAxis: {
          type: 'category',
          data: lanes,
          splitLine: { show: true, lineStyle: { color: t.grid } },
          axisLine: { show: false },
          axisLabel: { width: GRID_X.left - 14, overflow: 'truncate', color: t.text2, formatter: (v: string) => laneName(v) },
        },
        tooltip: {
          trigger: 'item',
          extraCssText: TT_CSS,
          formatter: (p: any) => {
            const c = byId.get(p?.data?.cid);
            return c ? commitmentTooltip(c, t, byId) : '';
          },
        },
        series: [
          {
            type: 'lines',
            coordinateSystem: 'cartesian2d',
            silent: true,
            z: 1,
            symbol: ['none', 'arrow'],
            symbolSize: 7,
            lineStyle: { color: t.text3, width: 1, type: [4, 3], curveness: 0.12, opacity: 0.9 },
            data: links,
          },
          {
            type: 'scatter',
            name: 'Commitments',
            z: 3,
            data: marks,
            emphasis: { scale: 1.15, itemStyle: { borderColor: t.text, borderWidth: 2 } },
            cursor: 'pointer',
            markLine: {
              silent: true,
              symbol: 'none',
              lineStyle: { color: t.line2, width: 1, type: 'solid' },
              label: { show: false },
              data: [{ xAxis: TODAY }],
            },
          },
          {
            type: 'scatter',
            name: 'struck',
            z: 4,
            symbol: 'path://M0,20 L20,0',
            itemStyle: { color: 'none', borderColor: t.text2, borderWidth: 1.5 },
            labelLayout: { hideOverlap: true },
            data: struck,
            cursor: 'pointer',
          },
        ],
      } as EChartsOption;
    },
    [range, commitments, commitsShown, sizeBy, lanes, laneOf, byId],
  );

  const stripEvents = useMemo(
    () => ({
      click: (p: any) => {
        const url = byId.get(p?.data?.cid)?.url;
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
      },
    }),
    [byId],
  );

  // ── tables ────────────────────────────────────────────────────────────────
  const capexRows = useMemo(() => {
    if (!prep || !model) return [];
    return Array.from({ length: prep.n }, (_, i) => i)
      .filter((i) => prep.totals[i] != null)
      .map((i) => ({ i, q: prep.q0 + i }));
  }, [prep, model]);
  const capexCols = useMemo<Col<{ i: number; q: number }>[]>(() => {
    if (!prep || !model) return [];
    const cell = (ci: number, i: number) => prep.cells[ci][i];
    return [
      { key: 'q', label: 'Quarter', sort: (r) => r.q, text: (r) => `${qKey(r.q)} ${qLabel(r.q)}`, render: (r) => <span className="font-mono text-ink">{qKey(r.q)}</span> },
      ...prep.companies.map(
        (c, ci): Col<{ i: number; q: number }> => ({
          key: c,
          label: c,
          align: 'right',
          sort: (r) => cell(ci, r.i)?.v ?? null,
          render: (r) => {
            const x = cell(ci, r.i);
            if (!x) return <span className="text-ink-3">—</span>;
            const row = model.actual.get(c)?.get(r.q);
            return (
              <span className={x.ghost ? 'italic text-ink-3' : ''} title={x.ghost ? 'Implied by guidance' : (row?.note ?? undefined)}>
                {x.ghost ? '≈' : ''}
                {mode === 'quarterly' && row?.url ? <ExtLink href={row.url}>{x.v.toFixed(1)}</ExtLink> : x.v.toFixed(1)}
              </span>
            );
          },
        }),
      ),
      {
        key: 'total',
        label: 'Total',
        align: 'right',
        sort: (r) => prep.totals[r.i],
        render: (r) => (
          <span className={`font-semibold ${prep.ghostAt[r.i] ? 'italic text-ink-3' : 'text-ink'}`}>
            {prep.ghostAt[r.i] ? '≈' : ''}
            {prep.totals[r.i]!.toFixed(1)}
          </span>
        ),
      },
    ];
  }, [prep, model, mode]);

  const commitCols = useMemo<Col<Commitment>[]>(
    () => [
      { key: 'date', label: 'Date', sort: (c) => c.t, render: (c) => <span className="whitespace-nowrap font-mono">{c.date}</span> },
      { key: 'company', label: 'Company', sort: (c) => laneName(c.company), render: (c) => <span className="whitespace-nowrap text-ink">{laneName(c.company)}</span> },
      {
        key: 'title',
        label: 'Commitment',
        sort: (c) => c.title,
        render: (c) => (
          <div className="min-w-[220px]">
            <ExtLink href={c.url}>{c.title}</ExtLink>
            {c.counterparties.length > 0 && <div className="text-[11.5px] text-ink-3">with {c.counterparties.join(', ')}</div>}
            {c.supersededBy && <div className="text-[11.5px] text-ink-3">→ superseded by {byId.get(c.supersededBy)?.title ?? c.supersededBy}</div>}
          </div>
        ),
      },
      { key: 'usd', label: '$B', align: 'right', sort: (c) => c.usdBillions, render: (c) => (c.usdBillions != null ? c.usdBillions.toLocaleString('en-US') : '—') },
      { key: 'gw', label: 'GW', align: 'right', sort: (c) => c.gigawatts, render: (c) => (c.gigawatts != null ? c.gigawatts : '—') },
      { key: 'horizon', label: 'Horizon', sort: (c) => c.horizon, render: (c) => c.horizon ?? '—' },
      { key: 'status', label: 'Status', sort: (c) => c.status, render: (c) => <StatusGlyph s={c.status} /> },
    ],
    [byId],
  );

  // ── render ────────────────────────────────────────────────────────────────
  // ── filter rows ───────────────────────────────────────────────────────────
  const qPresets = useMemo(quarterPresets, []);
  const capexOpts = useMemo<Option[]>(() => (model ? model.companies.map((c) => ({ value: c, label: c, color: companyColor(c, t), glyph: '■', count: model.actual.get(c)?.size ?? 0 })) : []), [model, t]);
  const quarterMarks = useMemo(() => (full ? new Set(Array.from({ length: full.q1 - full.q0 + 1 }, (_, i) => isoFromTime(qStart(full.q0 + i)))) : undefined), [full]);
  const capexPills = compact([
    multiPill('co', 'Company', capexCos, (c) => c, () => setCapexCos([])),
    datePill('q', 'Quarters', capexQ, () => setCapexQ(ANY_DATE)),
  ]);
  const capexRow = model && (
    <FilterRow pills={capexPills} onClearAll={clearCapex} count={capexQuarters.length} total={full ? full.q1 - full.q0 + 1 : undefined} noun="quarters">
      <MultiSelect label="Company" options={capexOpts} value={capexCos} onChange={setCapexCos} width={250} />
      <DateFilter label="Quarters" value={capexQ} onChange={setCapexQ} marks={quarterMarks} presets={qPresets} minYear={full ? Math.floor(full.q0 / 4) : undefined} />
    </FilterRow>
  );

  const commitFacets = useMemo(() => {
    const opts = (skip: CommitFacet, key: (c: Commitment) => string | string[], label: (v: string) => string, extra: (v: string) => Partial<Option> = () => ({})): Option[] => {
      const counts = countBy(filterCommitments(commitments, cf, skip), key);
      return [...countBy(commitments, key).keys()]
        .map((v) => ({ value: v, label: label(v), count: counts.get(v) ?? 0, ...extra(v) }))
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label));
    };
    return {
      companies: opts('companies', (c) => c.company, laneName),
      statuses: opts('statuses', (c) => c.status, (s) => STATUS_LABEL[s as Commitment['status']] ?? s, (s) => ({ color: 'var(--text-2)', glyph: STATUS_GLYPH[s as Commitment['status']] })),
      counterparties: opts('counterparties', (c) => c.counterparties, (v) => v),
      usd: numDomain(
        commitments.map((c) => c.usdBillions),
        [0, 100],
      ),
      dates: new Set(commitments.map((c) => c.date)),
      minYear: commitments.length ? Number(commitments[0].date.slice(0, 4)) : undefined,
    };
  }, [commitments, cf]);
  const usdDomain: [number, number] = [0, Math.ceil(commitFacets.usd[1] / 50) * 50];
  const commitPills = compact([
    textPill('q', cf.q, () => setC('q', '')),
    multiPill('co', 'Company', cf.companies, laneName, () => setC('companies', [])),
    multiPill('st', 'Status', cf.statuses, (s) => STATUS_LABEL[s as Commitment['status']] ?? s, () => setC('statuses', [])),
    multiPill('cp', 'Counterparty', cf.counterparties, (v) => v, () => setC('counterparties', [])),
    rangePill('size', 'Size', cf.size, usdDomain, (n) => `$${n}B`, () => setC('size', {})),
    datePill('date', 'Announced', cf.date, () => setC('date', ANY_DATE)),
  ]);
  const commitRow = commitments.length > 0 && (
    <FilterRow pills={commitPills} onClearAll={clearCommits} count={commitsShown.length} total={commitments.length} noun="commitments">
      <SearchInput value={cf.q} onChange={(v) => setC('q', v)} placeholder="Search deals, partners…" className="w-full sm:w-52" />
      <MultiSelect label="Company" options={commitFacets.companies} value={cf.companies} onChange={(v) => setC('companies', v)} width={250} />
      <MultiSelect label="Status" options={commitFacets.statuses} value={cf.statuses} onChange={(v) => setC('statuses', v)} width={230} />
      <MultiSelect label="Counterparty" options={commitFacets.counterparties} value={cf.counterparties} onChange={(v) => setC('counterparties', v)} searchable width={300} />
      <RangeFilter label="Size" domain={usdDomain} step={5} value={cf.size} onChange={(v) => setC('size', v)} format={(n) => `$${n}B`} />
      <DateFilter label="Announced" value={cf.date} onChange={(v) => setC('date', v)} marks={commitFacets.dates} minYear={commitFacets.minYear} />
    </FilterRow>
  );

  const legendItems = model
    ? [
        ...companies.map((c) => ({ label: c, color: companyColor(c, t), glyph: '■' })),
        ...(implied.size ? [{ label: 'Implied by guidance', color: t.text3, dashed: true }] : []),
      ]
    : [];
  const guides = model?.guidance ?? [];

  return (
    <Panel
      kicker="Capex · compute commitments"
      title={
        <span className="inline-flex items-center gap-2">
          AI spending over time
          <InfoTip align="left">
            Cash capital expenditure (purchases of property & equipment) by the five largest AI-infrastructure spenders, mapped to calendar quarters. Finance leases are
            data-centre capacity acquired on lease rather than paid for up front; toggle them in to approximate the companies’ headline figures. Dashed bars are
            not reported: they spread each company’s latest guided total over the quarters it hasn’t reported yet.
          </InfoTip>
        </span>
      }
      actions={
        <>
          <Segmented label="Capex view" options={MODE_OPTS} value={mode} onChange={setMode} />
          <Toggle checked={leases} onChange={setLeases} title="Add finance-lease capacity where the company reports it">
            Finance leases
          </Toggle>
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
      footer={<SpendingFooter model={model} />}
    >
      <HeroRow>
        <HeroStat
          i={0}
          label="Capex · last 4 quarters"
          value={ttm ? <CountUp value={ttm.total} format={fmtB} /> : '—'}
          sub={ttm ? `${qKey(ttm.endQ - 3)} → ${qKey(ttm.endQ)} · ${ttm.companies.length} companies · ${leases ? 'incl. finance leases' : 'cash capex'}` : 'Needs data/curated/capex.yaml'}
        />
        <HeroStat
          i={1}
          label="Year over year"
          value={ttm?.yoy != null ? <CountUp value={ttm.yoy} format={(v) => fmtPct(v)} /> : '—'}
          sub={ttm?.prev != null ? `vs ${fmtB(ttm.prev)} in the prior 4 quarters${ttm.likeForLike ? '' : ' (like-for-like)'}` : 'Needs 8 quarters of data'}
        />
        <HeroStat
          i={2}
          label="Largest single commitment"
          value={
            largest ? (
              largest.unit === 'usd' ? (
                <CountUp value={largest.c.usdBillions!} format={fmtB} />
              ) : (
                <CountUp value={largest.c.gigawatts!} format={(v) => `${v.toFixed(1)} GW`} />
              )
            ) : (
              '—'
            )
          }
          sub={
            largest
              ? `${laneName(largest.c.company)} · ${largest.c.status} · ${largest.c.title}${largest.contracted ? ` · largest contracted: ${fmtB(largest.contracted.usdBillions!)} (${largest.contracted.title})` : ''}`
              : 'Needs data/curated/spending-commitments.yaml'
          }
        />
      </HeroRow>

      <Swap k={view}>
        {view === 'chart' ? (
          <>
            {capexRow}
            {model && prep ? (
              <>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-[12px] text-ink-3">{MODE_SUB[mode]}</div>
                  <Legend items={legendItems} />
                </div>
                <EChart option={capexOption} height={340} ariaLabel={`Stacked ${mode} capex by company`} />
                {guides.some((g) => companies.includes(g.company)) && <GuidanceRow model={model} t={t} companies={companies} />}
              </>
            ) : model ? (
              <FilterEmpty onClear={clearCapex} h={300}>
                No capex quarters match these filters.
              </FilterEmpty>
            ) : (
              <EmptyState title="No capex data yet" file="data/curated/capex.yaml" h={300} />
            )}

            <div className="mt-6">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="kicker">Compute commitments</div>
                  <InfoTip>
                    One row per committing company. Marker area ∝ {sizeBy === 'usd' ? 'announced $ value' : 'gigawatts'}; small dashed rings have no{' '}
                    {sizeBy === 'usd' ? '$ figure' : 'GW figure'}. Filled = contracted, ring = announced, grey struck-through = revised or cancelled; dashed arrows point
                    to the deal that superseded it. Click a marker to open the source.
                  </InfoTip>
                </div>
                {commitments.length > 0 && (
                  <Segmented
                    label="Size markers by"
                    options={[
                      { value: 'usd', label: 'Size: $B' },
                      { value: 'gw', label: 'Size: GW' },
                    ]}
                    value={sizeBy}
                    onChange={setSizeBy}
                  />
                )}
              </div>
              {commitRow}
              {commitsShown.length ? (
                <>
                  <EChart option={stripOption} onEvents={stripEvents} height={40 + lanes.length * 34} ariaLabel="Compute commitments timeline" />
                  <StripLegend t={t} />
                </>
              ) : commitments.length ? (
                <FilterEmpty onClear={clearCommits} h={140}>
                  No commitments match these filters.
                </FilterEmpty>
              ) : (
                <EmptyState title="No compute commitments yet" file="data/curated/spending-commitments.yaml" h={140} />
              )}
            </div>
          </>
        ) : (
          <div className="space-y-5">
            {model ? (
              <div>
                <div className="kicker mb-2">
                  Capex by company · {MODE_SUB[mode]}
                  {leases ? ' · incl. finance leases' : ''}
                </div>
                {capexRow}
                {prep ? (
                  <SortTable cols={capexCols} rows={capexRows} rowKey={(r) => String(r.q)} initial={{ key: 'q', dir: 'desc' }} caption="Capex by quarter and company" />
                ) : (
                  <FilterEmpty onClear={clearCapex} h={160}>
                    No capex quarters match these filters.
                  </FilterEmpty>
                )}
              </div>
            ) : (
              <EmptyState title="No capex data yet" file="data/curated/capex.yaml" h={180} />
            )}
            {commitments.length ? (
              <div>
                <div className="kicker mb-2">Compute commitments</div>
                {commitRow}
                {commitsShown.length ? (
                  <SortTable cols={commitCols} rows={commitsShown} rowKey={(c) => c.id} initial={{ key: 'date', dir: 'desc' }} caption="Compute commitments" searchable={false} />
                ) : (
                  <FilterEmpty onClear={clearCommits} h={120}>
                    No commitments match these filters.
                  </FilterEmpty>
                )}
              </div>
            ) : (
              <EmptyState title="No compute commitments yet" file="data/curated/spending-commitments.yaml" h={120} />
            )}
          </div>
        )}
      </Swap>
    </Panel>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────
function guideRange(g: { low: number | null; high: number | null; mid: number | null }) {
  if (g.low != null && g.high != null && g.low !== g.high) return `$${Math.round(g.low)}–${Math.round(g.high)}B`;
  const v = g.mid ?? g.low ?? g.high;
  return v != null ? `~$${Math.round(v)}B` : 'n/a';
}

function GuidanceRow({ model, t, companies }: { model: NonNullable<ReturnType<typeof buildCapexModel>>; t: Tokens; companies: string[] }) {
  // Latest statement per company-period, in the fixed company order (only the companies in view).
  const latest = new Map<string, (typeof model.guidance)[number]>();
  for (const g of model.guidance) {
    if (!companies.includes(g.company)) continue;
    const k = `${g.company}|${g.period}`;
    const p = latest.get(k);
    if (!p || (g.issued ?? '') >= (p.issued ?? '')) latest.set(k, g);
  }
  const order = (c: string) => {
    const i = (CAPEX_COMPANIES as readonly string[]).indexOf(c);
    return i < 0 ? 99 : i;
  };
  const list = [...latest.values()].sort((a, b) => order(a.company) - order(b.company));
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-2">
      <span className="kicker">Guided</span>
      {list.map((g) => (
        <span key={`${g.company}${g.period}`} className="inline-flex items-center gap-1.5" title={[g.basis, g.note].filter(Boolean).join(' — ')}>
          <span className="inline-block h-2.5 w-2.5 rounded-[3px] border border-dashed" style={{ borderColor: companyColor(g.company, t) }} />
          <ExtLink href={g.url}>
            {g.company} {guideRange(g)}
          </ExtLink>
          <span className="text-ink-3">
            {g.period}
            {g.includesLeases ? ' · incl. leases' : ''}
            {g.issued ? ` · ${shortDate(g.issued)}` : ''}
          </span>
        </span>
      ))}
    </div>
  );
}

function StripLegend({ t }: { t: Tokens }) {
  const hue = violet(t);
  const dot = (style: React.CSSProperties, strike = false) => (
    <span className="relative inline-block h-3 w-3 rounded-full" style={style}>
      {strike && <span className="absolute left-[-2px] top-1/2 h-[1.5px] w-4 -rotate-45 bg-ink-2" />}
    </span>
  );
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-2">
      <span className="inline-flex items-center gap-1.5">{dot({ background: hue })}Contracted</span>
      <span className="inline-flex items-center gap-1.5">{dot({ border: `2px solid ${hue}` })}Announced</span>
      <span className="inline-flex items-center gap-1.5">{dot({ border: `1.5px solid ${t.text3}` }, true)}Revised / cancelled</span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-4 border-t border-dashed border-ink-3" />
        Superseded by →
      </span>
    </div>
  );
}

function StatusGlyph({ s }: { s: Commitment['status'] }) {
  const glyph = s === 'contracted' ? '●' : s === 'announced' ? '○' : '⊘';
  return (
    <span className={`whitespace-nowrap ${s === 'revised' || s === 'cancelled' ? 'text-ink-3 line-through decoration-ink-3' : 'text-ink-2'}`}>
      <span aria-hidden className="mr-1">
        {glyph}
      </span>
      {STATUS_LABEL[s]}
    </span>
  );
}

function commitmentTooltip(c: Commitment, t: Tokens, byId: Map<string, Commitment>) {
  let html = ttHead(t, c.title, shortDate(c.date));
  html += `<div style="color:${t.text2};margin-bottom:4px">${esc(laneName(c.company))}${c.counterparties.length ? ` → ${esc(c.counterparties.join(', '))}` : ''}</div>`;
  if (c.usdBillions != null) html += ttRow(t, t.text3, 'Value', fmtB(c.usdBillions));
  if (c.gigawatts != null) html += ttRow(t, t.text3, 'Power', `${c.gigawatts} GW`);
  if (c.horizon) html += ttRow(t, t.text3, 'Horizon', c.horizon);
  html += ttRow(t, t.text3, 'Status', STATUS_LABEL[c.status]);
  if (c.supersededBy) html += ttNote(t, `Superseded by: ${byId.get(c.supersededBy)?.title ?? c.supersededBy}`);
  const from = [...byId.values()].filter((x) => x.supersededBy === c.id);
  if (from.length) html += ttNote(t, `Supersedes: ${from.map((x) => x.title).join('; ')}`);
  if (c.note) html += ttNote(t, c.note);
  if (c.url) html += ttNote(t, 'Click to open the source ↗');
  return html;
}

function SpendingFooter({ model }: { model: ReturnType<typeof buildCapexModel> }) {
  if (!model) return <span>Sources: company filings, curated in data/curated/capex.yaml.</span>;
  const reported = [...model.lastReported.entries()].map(([c, q]) => `${c} ${qKey(q)}`).join(' · ');
  const totalRows = model.rows.length;
  const leaseRows = model.rows.filter((r) => r.financeLeases != null).length;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none">
        <span className="text-ink-2">Cash capex from SEC filings ({totalRows} company-quarters; finance leases reported for {leaseRows}).</span> Latest: {reported}.{' '}
        <span className="underline decoration-line-2 underline-offset-2 group-open:hidden">Definitions ▾</span>
      </summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        {model.definition && <p>{model.definition}</p>}
        {model.fiscalMapping && <p>{model.fiscalMapping}</p>}
        {Object.entries(model.financeLeasesBasis).map(([c, v]) => (
          <p key={c}>
            <span className="text-ink-2">{c} finance leases:</span> {v}
          </p>
        ))}
        <Notice>
          Quarterly “implied by guidance” values = (latest guided total for the period − quarters already reported, on the guidance’s own basis) ÷ quarters left.
          Guidance stated on a basis that includes finance leases (Microsoft, Meta headline capex) is best compared with “Finance leases” on.
        </Notice>
      </div>
    </details>
  );
}
