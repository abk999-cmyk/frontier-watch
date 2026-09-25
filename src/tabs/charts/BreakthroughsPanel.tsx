import type { EChartsOption } from 'echarts';
import { useCallback, useMemo, useState } from 'react';
import { EChart } from '../../charts/EChart.tsx';
import { DateFilter, MultiSelect, RangeFilter, SearchInput, type Option } from '../../components/filters/Filters.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { InfoTip } from '../../components/ui/misc.tsx';
import { useCharts } from '../../lib/data.ts';
import { ANY_DATE, countBy, highlightParts } from '../../lib/filters.ts';
import { shortDate } from '../../lib/format.ts';
import { useTokens, type Tokens } from '../../lib/tokens.ts';
import {
  AUTONOMIES,
  cumulativeAtLeast,
  hash01,
  parseBreakthroughs,
  TIER_NAMES,
  tierName,
  VERIFICATIONS,
  type Autonomy,
  type Breakthrough,
  type Domain,
  type Verification,
} from './cbData.ts';
import { alpha, catPalette, CountUp, EmptyState, esc, ExtLink, FilterEmpty, HeroRow, HeroStat, ordinalRamp, SortTable, Swap, TT_CSS, ttHead, ttNote, ttRow, useNarrow, type Col } from './cbUi.tsx';
import { FilterRow } from './common.tsx';
import { BT_EMPTY, btAutonomy, btFields, btModel, compact, datePill, filterBreakthroughs, multiPill, rangePill, textPill, type BtFacet, type BtFilter } from './filterModel.ts';

type View = 'scatter' | 'cumulative' | 'table';
const DOMAINS: Domain[] = ['math', 'science'];
const DOMAIN_LABEL: Record<Domain, string> = { math: 'Math', science: 'Science' };
const VERIF_META: Record<Verification, { label: string; glyph: string; symbol: string; hollow?: boolean }> = {
  'formal-proof': { label: 'Formal proof', glyph: '◆', symbol: 'diamond' },
  'peer-reviewed': { label: 'Peer-reviewed', glyph: '●', symbol: 'circle' },
  'expert-endorsed': { label: 'Expert-endorsed', glyph: '▲', symbol: 'triangle' },
  claimed: { label: 'Claimed', glyph: '○', symbol: 'circle', hollow: true },
  // ✕ drawn as a filled path so it reads at marker size
  disputed: { label: 'Disputed', glyph: '✕', symbol: 'path://M2,0 L10,8 L18,0 L20,2 L12,10 L20,18 L18,20 L10,12 L2,20 L0,18 L8,10 L0,2 Z' },
};
const AUTONOMY_SIZE: Record<Autonomy, number> = { tool: 9, collaborative: 13, autonomous: 18 };
const TIER_SHORT = ['0 Redisc.', '1 Interest.', '2 Solid', '3 Major', '4 Breakthr.', '5 Nobel'];
const AUTONOMY_LABEL: Record<Autonomy | 'unstated', string> = { tool: 'AI as tool', collaborative: 'Human + AI', autonomous: 'AI end-to-end', unstated: 'Not stated' };
const VERIFIED: Verification[] = ['formal-proof', 'peer-reviewed'];
const DAY = 864e5;
const NOW = Date.now();

const domainColor = (d: Domain, t: Tokens) => catPalette(t)[d === 'math' ? 0 : 1];
const jitterY = (b: Breakthrough) => b.significance + (hash01(b.id) - 0.5) * 0.5;

export default function BreakthroughsPanel() {
  const charts = useCharts();
  const t = useTokens();
  const all = useMemo(() => parseBreakthroughs(charts?.breakthroughs), [charts]);
  const narrow = useNarrow();

  const [view, setView] = useState<View>('scatter');
  const [f, setF] = useState<BtFilter>(BT_EMPTY);
  const set = useCallback(<K extends keyof BtFilter>(k: K, v: BtFilter[K]) => setF((prev) => ({ ...prev, [k]: v })), []);
  const clear = useCallback(() => setF(BT_EMPTY), []);

  const filtered = useMemo(() => filterBreakthroughs(all, f), [all, f]);
  const byId = useMemo(() => new Map(all.map((b) => [b.id, b])), [all]);

  // ── facet options: counts reflect every other active filter ──────────────
  const facets = useMemo(() => {
    const counted = (skip: BtFacet, key: (b: Breakthrough) => string | string[] | null) => countBy(filterBreakthroughs(all, f, skip), key);
    const universe = (key: (b: Breakthrough) => string | string[] | null) => [...countBy(all, key).keys()];
    const list = (skip: BtFacet, key: (b: Breakthrough) => string | string[] | null, extra: (v: string) => Partial<Option> = () => ({})): Option[] => {
      const c = counted(skip, key);
      return universe(key)
        .map((v) => ({ value: v, label: v, count: c.get(v) ?? 0, ...extra(v) }))
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label));
    };
    const dc = counted('domains', (b) => b.domain);
    const vc = counted('verifs', (b) => b.verification);
    const ac = counted('autonomy', btAutonomy);
    return {
      domains: DOMAINS.map((d) => ({ value: d, label: DOMAIN_LABEL[d], count: dc.get(d) ?? 0, color: domainColor(d, t), glyph: '●' })),
      fields: list('fields', btFields),
      orgs: list('orgs', (b) => b.org),
      models: list('models', btModel),
      tags: list('tags', (b) => b.tags),
      verifs: VERIFICATIONS.map((v) => ({ value: v, label: VERIF_META[v].label, count: vc.get(v) ?? 0, color: 'var(--text-2)', glyph: VERIF_META[v].glyph })),
      autonomy: ([...AUTONOMIES, 'unstated'] as const).filter((a) => a !== 'unstated' || all.some((b) => !b.autonomy)).map((a) => ({ value: a, label: AUTONOMY_LABEL[a], count: ac.get(a) ?? 0 })),
    };
  }, [all, f, t]);
  const dateMarks = useMemo(() => new Set(all.map((b) => b.date)), [all]);
  const labelOf = (opts: Option[]) => (v: string) => opts.find((o) => o.value === v)?.label ?? v;
  const pills = compact([
    textPill('q', f.q, () => set('q', '')),
    datePill('date', 'Date', f.date, () => set('date', ANY_DATE)),
    multiPill('domains', 'Domain', f.domains, labelOf(facets.domains), () => set('domains', [])),
    multiPill('fields', 'Field', f.fields, (v) => v, () => set('fields', [])),
    multiPill('orgs', 'Org', f.orgs, (v) => v, () => set('orgs', [])),
    multiPill('models', 'Model', f.models, (v) => v, () => set('models', [])),
    multiPill('tags', 'Tags', f.tags, (v) => v, () => set('tags', [])),
    rangePill('sig', 'Tier', f.sig, [0, 5], String, () => set('sig', {})),
    multiPill('verifs', 'Verification', f.verifs, labelOf(facets.verifs), () => set('verifs', [])),
    multiPill('autonomy', 'Autonomy', f.autonomy, labelOf(facets.autonomy), () => set('autonomy', [])),
  ]);

  // ── hero (whole dataset) ──────────────────────────────────────────────────
  const hero = useMemo(() => {
    const last12 = all.filter((b) => b.t >= NOW - 365 * DAY).length;
    const prev12 = all.filter((b) => b.t >= NOW - 730 * DAY && b.t < NOW - 365 * DAY).length;
    const verified = all.filter((b) => VERIFIED.includes(b.verification)).sort((a, b) => b.significance - a.significance || b.t - a.t)[0] ?? null;
    return {
      last12,
      prev12,
      verified,
      math: all.filter((b) => b.domain === 'math').length,
      science: all.filter((b) => b.domain === 'science').length,
      since: all[0]?.date.slice(0, 4),
    };
  }, [all]);

  // ── scatter ───────────────────────────────────────────────────────────────
  const xMin = all.length ? all[0].t - 120 * DAY : NOW - 3650 * DAY;
  const xMax = NOW + 60 * DAY;
  const scatterOption = useCallback(
    (t: Tokens): EChartsOption => ({
      grid: { left: narrow ? 76 : 118, right: narrow ? 12 : 28, top: 20, bottom: 32 },
      xAxis: {
        type: 'time',
        min: xMin,
        max: xMax,
        splitLine: { show: false },
        axisLine: { onZero: false, lineStyle: { color: t.axis } },
        axisLabel: { formatter: (v: number) => String(new Date(v).getFullYear()), hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        min: -0.5,
        max: 5.5,
        // Ticks, labels and grid lines sit on the named tiers; the ±0.25 jitter stays inside each band.
        axisTick: { show: false, customValues: [0, 1, 2, 3, 4, 5] },
        axisLabel: { customValues: [0, 1, 2, 3, 4, 5], formatter: (v: number) => (narrow ? TIER_SHORT[v] : `${v} ${TIER_NAMES[v] ?? ''}`) },
        splitLine: { show: true, lineStyle: { color: t.grid } },
      },
      tooltip: {
        trigger: 'item',
        extraCssText: TT_CSS,
        formatter: (p: any) => {
          const b = byId.get(p?.data?.id);
          return b ? breakthroughTooltip(b, t) : '';
        },
      },
      series: DOMAINS.map((d) => {
        const c = domainColor(d, t);
        return {
          type: 'scatter',
          name: DOMAIN_LABEL[d],
          cursor: 'pointer',
          emphasis: { scale: 1.35, itemStyle: { borderColor: t.text, borderWidth: 2 } },
          labelLayout: { hideOverlap: true },
          data: filtered
            .filter((b) => b.domain === d)
            .map((b) => {
              const v = VERIF_META[b.verification];
              return {
                id: b.id,
                value: [b.t, jitterY(b)],
                symbol: v.symbol,
                symbolSize: b.autonomy ? AUTONOMY_SIZE[b.autonomy] : 11,
                itemStyle: v.hollow
                  ? { color: alpha(c, 0.06), borderColor: c, borderWidth: 2 }
                  : b.verification === 'disputed'
                    ? { color: c, borderWidth: 0 } // a surface ring would eat the thin ✕ strokes
                    : { color: c, borderColor: t.surface, borderWidth: 1.5 },
                // Direct-label only the top tiers, by system name.
                label:
                  b.significance >= 4 && !narrow
                    ? { show: true, position: b.t > Date.now() - 548 * 864e5 ? 'left' : 'right', distance: 6, formatter: shortName(b), color: t.text2, fontFamily: t.mono, fontSize: 10 }
                    : undefined,
              };
            }),
        };
      }),
    }) as EChartsOption,
    [filtered, byId, xMin, xMax, narrow],
  );
  const events = useMemo(
    () => ({
      click: (p: any) => {
        const url = byId.get(p?.data?.id)?.url;
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
      },
    }),
    [byId],
  );

  // ── cumulative ────────────────────────────────────────────────────────────
  const sigLo = f.sig.min ?? 0;
  const sigHi = f.sig.max ?? 5;
  const tiers = useMemo(() => [1, 2, 3, 4, 5].filter((k) => k >= sigLo && k <= sigHi), [sigLo, sigHi]);
  const cumOption = useCallback(
    (t: Tokens): EChartsOption => {
      const ramp = ordinalRamp(5, t);
      const lines: { name: string; color: string; data: [number, number][]; width: number }[] = [];
      if (sigLo === 0) lines.push({ name: 'All', color: t.text3, data: cumulativeAtLeast(filtered, 0, NOW), width: 1.5 });
      for (const k of tiers) lines.push({ name: `≥ ${TIER_NAMES[k]}`, color: ramp[k - 1], data: cumulativeAtLeast(filtered, k, NOW), width: 2 });
      return {
        grid: { left: 44, right: 132, top: 20, bottom: 32 },
        xAxis: { type: 'time', min: xMin, max: xMax, splitLine: { show: false }, axisLabel: { formatter: (v: number) => String(new Date(v).getFullYear()), hideOverlap: true } },
        yAxis: { type: 'value', minInterval: 1, name: 'count', nameLocation: 'end', nameGap: 10, nameTextStyle: { align: 'right' } },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'line', lineStyle: { color: t.line2 } },
          extraCssText: TT_CSS,
          formatter: (ps: any) => {
            const list = Array.isArray(ps) ? ps : [ps];
            const x = Number(list[0]?.axisValue);
            let html = ttHead(t, shortDate(new Date(x).toISOString().slice(0, 10)), 'cumulative count');
            for (const l of [...lines].reverse()) {
              const n = l.data.filter(([tt]) => tt <= x).at(-1)?.[1] ?? 0;
              html += ttRow(t, l.color, l.name, String(n));
            }
            return html;
          },
        },
        series: lines.map((l) => ({
          type: 'line',
          name: l.name,
          step: 'end',
          data: l.data,
          showSymbol: false,
          lineStyle: { width: l.width, color: l.color },
          itemStyle: { color: l.color },
          emphasis: { focus: 'series' },
          endLabel: { show: true, formatter: (p: any) => `${l.name} · ${p.value[1]}`, color: t.text2, fontFamily: t.mono, fontSize: 10, distance: 6 },
          labelLayout: { moveOverlap: 'shiftY' },
        })),
      } as EChartsOption;
    },
    [filtered, tiers, sigLo, xMin, xMax],
  );

  // ── table ─────────────────────────────────────────────────────────────────
  const cols = useMemo<Col<Breakthrough>[]>(
    () => [
      { key: 'date', label: 'Date', sort: (b) => b.t, render: (b) => <span className="whitespace-nowrap font-mono">{b.date}</span> },
      {
        key: 'title',
        label: 'Result',
        sort: (b) => b.title,
        render: (b) => (
          <div className="min-w-[260px]" title={b.summary ?? undefined}>
            <ExtLink href={b.url}>
              <Hl text={b.title} q={f.q} />
            </ExtLink>
            {(b.field || b.tags.length > 0) && (
              <div className="text-[11.5px] text-ink-3">
                {b.field}
                {b.field && b.tags.length > 0 && ' · '}
                {b.tags.map((x) => `#${x}`).join(' ')}
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'domain',
        label: 'Domain',
        sort: (b) => b.domain,
        render: (b) => (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-[10px]" style={{ color: domainColor(b.domain, t) }}>
              ●
            </span>
            {DOMAIN_LABEL[b.domain]}
          </span>
        ),
      },
      { key: 'sig', label: 'Tier', sort: (b) => b.significance, render: (b) => <span className="whitespace-nowrap text-ink">{`${b.significance} ${tierName(b.significance)}`}</span> },
      { key: 'verif', label: 'Verification', sort: (b) => VERIFICATIONS.indexOf(b.verification), render: (b) => <span className="whitespace-nowrap">{`${VERIF_META[b.verification].glyph} ${VERIF_META[b.verification].label}`}</span> },
      { key: 'auto', label: 'Autonomy', sort: (b) => (b.autonomy ? AUTONOMIES.indexOf(b.autonomy) : null), render: (b) => <span className="whitespace-nowrap">{b.autonomy ? AUTONOMY_LABEL[b.autonomy] : '—'}</span> },
      { key: 'system', label: 'Model / system', sort: (b) => btModel(b), render: (b) => btModel(b) ?? '—' },
      { key: 'org', label: 'Org', sort: (b) => b.org, render: (b) => <span className="text-ink-3">{b.org ?? '—'}</span> },
    ],
    [t, f.q],
  );

  if (!all.length)
    return (
      <Panel kicker="AI in math & science" title="Math & science breakthroughs by significance">
        <EmptyState title="No breakthroughs curated yet" file="data/curated/breakthroughs.yaml" h={360} />
      </Panel>
    );

  return (
    <Panel
      kicker="AI in math & science"
      title={
        <span className="inline-flex items-center gap-2">
          Math &amp; science breakthroughs by significance
          <InfoTip align="left">
            Results where AI systems contributed to new mathematics or science, placed by date and a curated significance tier (0 rediscovery → 5 Millennium- or
            Nobel-level). Marker shape shows how the result was verified; marker size shows how autonomous the AI was. Tiers carry a slight fixed jitter so markers don’t
            stack. Click a marker to open its source.
          </InfoTip>
        </span>
      }
      actions={
        <Segmented
          label="View"
          options={[
            { value: 'scatter', label: 'Scatter' },
            { value: 'cumulative', label: 'Cumulative' },
            { value: 'table', label: 'Table' },
          ]}
          value={view}
          onChange={setView}
        />
      }
      footer={
        <span>
          Curated in <code className="font-mono">data/curated/breakthroughs.yaml</code>; every entry links its primary source. Significance and verification are editorial
          judgements; “claimed” and “disputed” results are shown, never promoted.
        </span>
      }
    >
      <HeroRow>
        <HeroStat i={0} label="Results tracked" value={<CountUp value={all.length} format={(v) => String(Math.round(v))} />} sub={`${hero.math} math · ${hero.science} science · since ${hero.since}`} />
        <HeroStat
          i={1}
          label="Last 12 months"
          value={<CountUp value={hero.last12} format={(v) => String(Math.round(v))} />}
          sub={hero.prev12 ? `vs ${hero.prev12} in the 12 months before` : 'none in the 12 months before'}
        />
        <HeroStat
          i={2}
          label="Top verified result"
          value={hero.verified ? <span className="block truncate">{hero.verified.system ?? hero.verified.title}</span> : '—'}
          sub={
            hero.verified ? (
              <ExtLink href={hero.verified.url}>
                {`${hero.verified.significance} ${tierName(hero.verified.significance)} · ${VERIF_META[hero.verified.verification].label.toLowerCase()} · ${hero.verified.date.slice(0, 4)}`}
              </ExtLink>
            ) : (
              'No formally proven or peer-reviewed result yet'
            )
          }
        />
      </HeroRow>

      {/* one filter row, scoping every view below */}
      <FilterRow pills={pills} onClearAll={clear} count={filtered.length} total={all.length} noun="results" className="mb-4">
        <SearchInput value={f.q} onChange={(v) => set('q', v)} placeholder="Search results, fields, systems…" className="w-full sm:w-60" />
        <DateFilter label="Date" value={f.date} onChange={(v) => set('date', v)} marks={dateMarks} minYear={2016} />
        <MultiSelect label="Domain" options={facets.domains} value={f.domains} onChange={(v) => set('domains', v)} width={240} />
        <MultiSelect label="Field" options={facets.fields} value={f.fields} onChange={(v) => set('fields', v)} searchable />
        <MultiSelect label="Org" options={facets.orgs} value={f.orgs} onChange={(v) => set('orgs', v)} searchable width={340} />
        <MultiSelect label="Model" options={facets.models} value={f.models} onChange={(v) => set('models', v)} searchable width={340} />
        {facets.tags.length > 0 && <MultiSelect label="Tags" options={facets.tags} value={f.tags} onChange={(v) => set('tags', v)} searchable />}
        <RangeFilter label="Tier" domain={[0, 5]} step={1} value={f.sig} onChange={(v) => set('sig', v)} format={(n) => `${n} ${TIER_NAMES[n] ?? ''}`.trim()} />
        <MultiSelect label="Verification" options={facets.verifs} value={f.verifs} onChange={(v) => set('verifs', v)} width={260} />
        <MultiSelect label="Autonomy" options={facets.autonomy} value={f.autonomy} onChange={(v) => set('autonomy', v)} width={250} />
      </FilterRow>

      <Swap k={view}>
        {view === 'scatter' &&
          (filtered.length ? (
            <>
              <EChart option={scatterOption} onEvents={events} height={400} ariaLabel="Breakthroughs by date and significance" />
              <ScatterLegend t={t} />
            </>
          ) : (
            <FilterEmpty onClear={clear} h={240}>No results match these filters.</FilterEmpty>
          ))}
        {view === 'cumulative' &&
          (filtered.length ? (
            <>
              <div className="mb-1 text-[12px] text-ink-3">Running count of results at or above each tier (every filter above applies).</div>
              <EChart option={cumOption} height={360} ariaLabel="Cumulative count of breakthroughs at or above each tier" />
            </>
          ) : (
            <FilterEmpty onClear={clear} h={240}>No results match these filters.</FilterEmpty>
          ))}
        {view === 'table' &&
          (filtered.length ? (
            <SortTable cols={cols} rows={filtered} rowKey={(b) => b.id} initial={{ key: 'date', dir: 'desc' }} maxH={480} caption="AI math and science breakthroughs" searchable={false} />
          ) : (
            <FilterEmpty onClear={clear} h={240}>No results match these filters.</FilterEmpty>
          ))}
      </Swap>
    </Panel>
  );
}

function shortName(b: Breakthrough) {
  const s = b.system ?? b.title;
  return s.length > 26 ? `${s.slice(0, 25)}…` : s;
}

function breakthroughTooltip(b: Breakthrough, t: Tokens) {
  const v = VERIF_META[b.verification];
  let html = ttHead(t, b.title);
  html += `<div style="color:${t.text3};font-size:11.5px;margin-bottom:6px">${shortDate(b.date)}${b.field ? ` · ${esc(b.field)}` : ''}</div>`;
  html += ttRow(t, domainColor(b.domain, t), 'Tier', `${b.significance} ${tierName(b.significance)}`);
  html += ttRow(t, t.text3, 'Verification', `${v.glyph} ${v.label}`);
  if (b.autonomy) html += ttRow(t, t.text3, 'Autonomy', AUTONOMY_LABEL[b.autonomy]);
  if (b.system) html += ttRow(t, t.text3, 'System', b.system);
  if (b.org) html += ttRow(t, t.text3, 'Org', b.org);
  if (b.summary) html += ttNote(t, b.summary);
  if (b.url) html += ttNote(t, 'Click to open the source ↗');
  return html;
}

function ScatterLegend({ t }: { t: Tokens }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-2">
      <span className="flex items-center gap-3">
        {DOMAINS.map((d) => (
          <span key={d} className="inline-flex items-center gap-1.5">
            <span className="text-[11px]" style={{ color: domainColor(d, t) }}>
              ●
            </span>
            {DOMAIN_LABEL[d]}
          </span>
        ))}
      </span>
      <span className="flex flex-wrap items-center gap-3">
        {VERIFICATIONS.map((v) => (
          <span key={v} className="inline-flex items-center gap-1">
            <span className="text-[11px] text-ink-2">{VERIF_META[v].glyph}</span>
            {VERIF_META[v].label}
          </span>
        ))}
      </span>
      <span className="flex items-center gap-3">
        {AUTONOMIES.map((a) => (
          <span key={a} className="inline-flex items-center gap-1.5">
            <span className="inline-block rounded-full bg-ink-3" style={{ width: AUTONOMY_SIZE[a] * 0.75, height: AUTONOMY_SIZE[a] * 0.75 }} />
            {AUTONOMY_LABEL[a]}
          </span>
        ))}
      </span>
    </div>
  );
}


/** Search hits in ink on a soft accent wash. */
function Hl({ text, q }: { text: string; q: string }) {
  return (
    <>
      {highlightParts(text, q).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-[var(--accent-soft)] px-0.5 text-ink">
            {p.t}
          </mark>
        ) : (
          p.t
        ),
      )}
    </>
  );
}
