import { useCallback, useMemo, useState } from 'react';
import { MultiSelect, RangeFilter, SearchInput, type Option } from '../../components/filters/Filters.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { InfoTip } from '../../components/ui/misc.tsx';
import { countBy } from '../../lib/filters.ts';
import { shortDate } from '../../lib/format.ts';
import { compact, multiPill, nextSort, rangePill, sortRows, textPill, type SortState } from '../charts/filterModel.ts';
import { filterProxies, lagDomain, PROXY_EMPTY, proxyMetric, proxySortValue, type ProxyFacet, type ProxyFilter, type ProxyRow, type ProxySortKey } from './filters.ts';
import { fmtLag, type LagSummary, type ProxyLag } from './lag.ts';
import type { Proxy } from './types.ts';
import { Code, EmptyState, FilterRow, Hl, hostOf, lagVar, metricLabel, NoMatches, SortTh } from './ui.tsx';

const STATUS_OPTS = [
  { value: 'reached', label: 'Reached', glyph: '✓', color: 'var(--good)' },
  { value: 'not-yet', label: 'Not yet', glyph: '○', color: 'var(--text-3)' },
];

export function ProxyTable({ proxies, summary }: { proxies: Proxy[]; summary: LagSummary }) {
  const [sort, setSort] = useState<SortState | null>({ key: 'lag', dir: 'desc' });
  const [f, setF] = useState<ProxyFilter>(PROXY_EMPTY);
  const set = useCallback(<K extends keyof ProxyFilter>(k: K, v: ProxyFilter[K]) => setF((prev) => ({ ...prev, [k]: v })), []);
  const clear = useCallback(() => setF(PROXY_EMPTY), []);

  const all = useMemo<ProxyRow[]>(() => proxies.map((p, i) => ({ p, l: summary.lags[i] })).filter((x) => x.l), [proxies, summary.lags]);
  const rows = useMemo(() => {
    const found = filterProxies(all, f);
    return sort ? sortRows(found, (r) => proxySortValue(r, sort.key as ProxySortKey), sort.dir) : found;
  }, [all, f, sort]);
  const onSort = useCallback(
    (k: string) =>
      setSort((s) =>
        nextSort(
          s,
          k,
          all.map((r) => proxySortValue(r, k as ProxySortKey)).find((v) => v != null),
        ),
      ),
    [all],
  );

  // Facet options (counts reflect the other active filters) and the lag domain.
  const facets = useMemo(() => {
    const counts = (skip: ProxyFacet, key: (r: ProxyRow) => string) => countBy(filterProxies(all, f, skip), key);
    const sc = counts('statuses', (r) => r.p.status);
    const wc = counts('weights', (r) => String(r.p.weight));
    const mc = counts('metrics', (r) => proxyMetric(r.p));
    const weights = [...new Set(all.map((r) => r.p.weight))].sort((a, b) => b - a);
    const metrics = [...new Set(all.map((r) => proxyMetric(r.p)))];
    return {
      statuses: STATUS_OPTS.map((o): Option => ({ ...o, count: sc.get(o.value) ?? 0 })),
      weights: weights.map((w): Option => ({ value: String(w), label: w === 1 ? 'Full weight (1)' : `Fuzzy (${w})`, count: wc.get(String(w)) ?? 0 })),
      metrics: metrics.map((m): Option => ({ value: m, label: m === 'unspecified' ? 'Unspecified' : metricLabel(m), count: mc.get(m) ?? 0 })).sort((a, b) => a.label.localeCompare(b.label)),
      lag: lagDomain(all.map((r) => r.l.months)),
    };
  }, [all, f]);
  const labelOf = (opts: Option[]) => (v: string) => opts.find((o) => o.value === v)?.label ?? v;
  const fmtMo = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)} mo`;
  const pills = compact([
    textPill('q', f.q, () => set('q', '')),
    multiPill('statuses', 'Status', f.statuses, labelOf(facets.statuses), () => set('statuses', [])),
    multiPill('weights', 'Weight', f.weights, (w) => w, () => set('weights', [])),
    rangePill('lag', 'Lag', f.lag, facets.lag, fmtMo, () => set('lag', {})),
    multiPill('metrics', 'Metric', f.metrics, labelOf(facets.metrics), () => set('metrics', [])),
  ]);
  // Symmetric scale around 0 so bar length compares honestly across ahead/behind.
  const span = Math.max(12, ...summary.lags.map((l) => Math.abs(l.months ?? 0)));

  return (
    <Panel
      kicker={
        <span className="inline-flex items-center gap-1.5">
          Proxy ledger
          <InfoTip align="left">
            Every proxy behind the headline. Lag = reality date − scenario date (months). Solid bars are observed; hatched bars are projections; an open-ended bar with ≥ is a lower bound that grows each month the event doesn’t
            happen. Weight 0.5 marks fuzzy proxies.
          </InfoTip>
        </span>
      }
      title="Measurable proxies, scenario vs reality"
      footer={
        proxies.length ? (
          <span>
            Weighted median {fmtLag(summary.months, summary.atLeast)} across {summary.counted} counted proxies. Curated in <Code>data/curated/ai2027-proxies.yaml</Code>.
          </span>
        ) : undefined
      }
    >
      {proxies.length === 0 ? (
        <EmptyState title="No proxies yet">
          Curated file missing: <Code>data/curated/ai2027-proxies.yaml</Code>
        </EmptyState>
      ) : (
        <>
          <FilterRow pills={pills} onClearAll={clear} count={rows.length} total={all.length} noun="proxies">
            <SearchInput value={f.q} onChange={(v) => set('q', v)} placeholder="Search proxies, notes…" className="w-full sm:w-56" />
            <MultiSelect label="Status" options={facets.statuses} value={f.statuses} onChange={(v) => set('statuses', v)} width={220} />
            <MultiSelect label="Weight" options={facets.weights} value={f.weights} onChange={(v) => set('weights', v)} width={230} />
            <RangeFilter label="Lag" domain={facets.lag} step={1} value={f.lag} onChange={(v) => set('lag', v)} format={fmtMo} />
            <MultiSelect label="Metric" options={facets.metrics} value={f.metrics} onChange={(v) => set('metrics', v)} width={280} />
          </FilterRow>
          {rows.length === 0 ? (
            <NoMatches onClear={clear}>No proxy matches these filters.</NoMatches>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[860px] text-[12.5px]">
                <thead className="bg-surface-2/80 text-left">
                  <tr className="kicker">
                    <SortTh k="name" sort={sort} onSort={onSort}>
                      Proxy
                    </SortTh>
                    <SortTh k="scenario" sort={sort} onSort={onSort}>
                      Scenario
                    </SortTh>
                    <SortTh k="reality" sort={sort} onSort={onSort}>
                      Reality / projected
                    </SortTh>
                    <SortTh k="lag" sort={sort} onSort={onSort} className="w-[240px]">
                      <span className="flex min-w-[200px] justify-between gap-2">
                        <span>← ahead</span>
                        <span>lag</span>
                        <span>behind →</span>
                      </span>
                    </SortTh>
                    <SortTh k="status" sort={sort} onSort={onSort}>
                      Status
                    </SortTh>
                    <th className="px-3 py-2 font-normal">Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ p, l }) => (
                    <tr key={p.id} className="border-t border-line align-top">
                      <td className="max-w-[300px] px-3 py-2">
                        <div className="font-medium leading-snug text-ink">
                          <Hl text={p.name} q={f.q} />
                        </div>
                        {p.realityRef && (
                          <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-3" title={p.realityRef}>
                            {p.realityRef}
                          </div>
                        )}
                        {(p.weight !== 1 || p.metric) && (
                          <div className="mt-0.5 font-mono text-[10.5px] text-ink-3">
                            {p.metric ? metricLabel(p.metric) : ''}
                            {p.metric && p.weight !== 1 ? ' · ' : ''}
                            {p.weight !== 1 ? `weight ${p.weight}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="tnum whitespace-nowrap px-3 py-2 text-ink-2">{shortDate(p.scenarioDate)}</td>
                      <td className="tnum whitespace-nowrap px-3 py-2 text-ink-2">
                        {l.kind === 'reached' ? (
                          shortDate(l.endDate!)
                        ) : l.kind === 'projected' ? (
                          <>
                            {shortDate(l.endDate!)} <span className="text-ink-3">projected</span>
                          </>
                        ) : (
                          <span className="text-ink-3">not yet</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <LagBar l={l} span={span} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {p.status === 'reached' ? (
                          <span className="inline-flex items-center gap-1.5 text-ink-2">
                            <span aria-hidden style={{ color: 'var(--good)' }}>
                              ✓
                            </span>
                            Reached
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-ink-2">
                            <span aria-hidden style={{ color: 'var(--text-3)' }}>
                              ○
                            </span>
                            Not yet
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(p.sources ?? []).map((s, i) => (
                            <a
                              key={s}
                              href={s}
                              target="_blank"
                              rel="noreferrer"
                              title={s}
                              className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3 hover:border-line-2 hover:text-ink"
                            >
                              {i + 1} {hostOf(s).split('.').slice(-2, -1)[0] ?? ''}
                            </a>
                          ))}
                          {!p.sources?.length && <span className="text-ink-3">—</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/** Diverging bar-in-cell around 0: ahead (−) grows left in blue, behind (+) grows right in orange. */
function LagBar({ l, span }: { l: ProxyLag; span: number }) {
  if (l.months == null) return <span className="text-[12px] text-ink-3">not counted · {l.reason}</span>;
  const pct = (Math.min(span, Math.abs(l.months)) / span) * 50;
  const pos = l.months >= 0;
  const color = lagVar(l.months);
  const hatch = l.kind === 'projected' ? `repeating-linear-gradient(135deg, ${color} 0 3px, transparent 3px 6px)` : color;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-3.5 flex-1" aria-hidden>
        <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--text-3)]" />
        <div
          className="absolute top-[3px] h-2"
          style={{
            left: pos ? '50%' : `${50 - pct}%`,
            width: `max(${pct}%, 2px)`,
            background: hatch,
            border: l.kind === 'projected' ? `1px solid ${color}` : undefined,
            borderRadius: pos ? '0 4px 4px 0' : '4px 0 0 4px',
            maskImage: l.atLeast ? 'linear-gradient(90deg, #000 70%, transparent)' : undefined,
          }}
        />
        {l.atLeast && (
          <span className="absolute top-[-3px] text-[12px] leading-none" style={{ left: `calc(50% + ${pct}% + 2px)`, color }}>
            ›
          </span>
        )}
      </div>
      <span className="tnum w-[76px] shrink-0 text-right font-medium text-ink">{fmtLag(l.months, l.atLeast)}</span>
    </div>
  );
}
