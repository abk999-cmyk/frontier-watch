import { useCallback, useMemo, useState } from 'react';
import { EChart } from '../../charts/EChart.tsx';
import { DateFilter, MultiSelect, type Option } from '../../components/filters/Filters.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { InfoTip, Legend } from '../../components/ui/misc.tsx';
import { ANY_DATE, countBy } from '../../lib/filters.ts';
import { monthYear, shortDate } from '../../lib/format.ts';
import { useTheme, type Tokens } from '../../lib/tokens.ts';
import { compact, datePill, multiPill, nextSort, sortRows, type SortState } from '../charts/filterModel.ts';
import { buildDriftModel, driftOption, yearsOut, type DriftRow } from './drift.ts';
import { DRIFT_EMPTY, driftActive, driftMilestone, filterDriftModel, matchDrift, type DriftFacet, type DriftFilter } from './filters.ts';
import { MILESTONE_META, type MilestoneKey } from './forecasts.ts';
import type { ForecastUpdate } from './types.ts';
import { Code, EmptyState, ExtLink, FilterRow, hostOf, NoMatches, PALETTE, SortTh } from './ui.tsx';

type SortKey = 'milestone' | 'forecaster' | 'published' | 'median' | 'out';

export function DriftPanel({ updates, now }: { updates: ForecastUpdate[]; now: string }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const pal = PALETTE[useTheme()];
  const full = useMemo(() => buildDriftModel(updates), [updates]);
  const colorOf = useCallback((k: MilestoneKey) => pal[MILESTONE_META[k].slot], [pal]);

  // ── filters (one model, so chart and table always agree) ──────────────────
  const [f, setF] = useState<DriftFilter>(DRIFT_EMPTY);
  const set = useCallback(<K extends keyof DriftFilter>(k: K, v: DriftFilter[K]) => setF((prev) => ({ ...prev, [k]: v })), []);
  const clear = useCallback(() => setF(DRIFT_EMPTY), []);
  const model = useMemo(() => filterDriftModel(full, f), [full, f]);
  const { rows, charted, keys: keysPresent, forecasters, marks } = model;
  const tableOnly = rows.length - charted.length;
  const option = useCallback((t: Tokens) => driftOption(model, t, colorOf, now), [model, colorOf, now]);

  const milestoneLabel = useCallback((v: string) => (v.startsWith('raw:') ? v.slice(4) : (MILESTONE_META[v as MilestoneKey]?.label ?? v)), []);
  const facets = useMemo(() => {
    const counts = (skip: DriftFacet, key: (r: DriftRow) => string) => countBy(full.rows.filter((r) => matchDrift(r, f, skip)), key);
    const fc = counts('forecasters', (r) => r.forecaster);
    const mc = counts('milestones', driftMilestone);
    const names = [...new Set(full.rows.map((r) => r.forecaster))];
    const ms = [...new Set(full.rows.map(driftMilestone))].sort((a, b) => Number(a.startsWith('raw:')) - Number(b.startsWith('raw:')) || milestoneLabel(a).localeCompare(milestoneLabel(b)));
    return {
      forecasters: names.map((n): Option => {
        const mk = full.marks.get(n);
        return { value: n, label: n, count: fc.get(n) ?? 0, glyph: mk?.glyph, color: mk ? 'var(--text-2)' : undefined, hint: mk ? undefined : 'table only' };
      }),
      milestones: ms.map((v): Option => ({ value: v, label: milestoneLabel(v), count: mc.get(v) ?? 0, glyph: '■', color: v.startsWith('raw:') ? 'var(--text-3)' : colorOf(v as MilestoneKey), hint: v.startsWith('raw:') ? 'table only' : undefined })),
      marks: new Set(full.rows.map((r) => r.published)),
      minYear: full.rows.length ? Math.min(...full.rows.map((r) => Number(r.published.slice(0, 4)))) : undefined,
    };
  }, [full, f, colorOf, milestoneLabel]);
  const pills = compact([
    multiPill('forecasters', 'Forecaster', f.forecasters, (v) => v, () => set('forecasters', [])),
    multiPill('milestones', 'Milestone', f.milestones, milestoneLabel, () => set('milestones', [])),
    datePill('published', 'Published', f.published, () => set('published', ANY_DATE)),
  ]);

  // ── table sort ────────────────────────────────────────────────────────────
  const [sort, setSort] = useState<SortState | null>(null);
  const sortValue = useCallback(
    (r: DriftRow, k: SortKey): string | number => (k === 'milestone' ? milestoneLabel(driftMilestone(r)) : k === 'forecaster' ? r.forecaster : k === 'published' ? r.published : k === 'median' ? r.median : yearsOut(r)),
    [milestoneLabel],
  );
  const tableRows = useMemo(() => (sort ? sortRows(rows, (r) => sortValue(r, sort.key as SortKey), sort.dir) : rows), [rows, sort, sortValue]);
  const onSort = useCallback((k: string) => setSort((s) => nextSort(s, k, rows[0] ? sortValue(rows[0], k as SortKey) : null)), [rows, sortValue]);

  const legendItems = [
    ...keysPresent.map((k) => ({ label: MILESTONE_META[k].label, color: colorOf(k), glyph: '▬' })),
    ...forecasters.map((fc) => {
      const mk = marks.get(fc)!;
      return { label: fc, color: 'var(--text-2)', glyph: `${mk.line === 'solid' ? '━━' : mk.line === 'dashed' ? '╍╍' : '┈┈'} ${mk.glyph}` };
    }),
  ];

  return (
    <Panel
      kicker={
        <span className="inline-flex items-center gap-1.5">
          Forecast drift
          <InfoTip align="left">
            Each point is one published median from the AI 2027 authors (<Code>ai2027-updates.yaml</Code>): x = when they published it, y = the date they expected the milestone. A line rising faster than the dotted y = x
            diagonal means their forecast moved further out. Colour = milestone, line style = forecaster.
          </InfoTip>
        </span>
      }
      title="How the authors’ own medians have moved"
      actions={
        updates.length ? (
          <Segmented
            label="Chart or table"
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: 'Chart' },
              { value: 'table', label: 'Table' },
            ]}
          />
        ) : undefined
      }
      footer={tableOnly > 0 ? `${tableOnly} update${tableOnly > 1 ? 's' : ''} for other milestones appear in the table only.` : undefined}
    >
      {updates.length === 0 ? (
        <EmptyState title="No forecast updates yet">
          Curated file missing: <Code>data/curated/ai2027-updates.yaml</Code>. Once it lists the authors’ published medians, this chart plots how they drifted.
        </EmptyState>
      ) : (
        <>
          <FilterRow pills={pills} onClearAll={clear} count={rows.length} total={full.rows.length} noun="updates">
            <MultiSelect label="Forecaster" options={facets.forecasters} value={f.forecasters} onChange={(v) => set('forecasters', v)} width={320} />
            <MultiSelect label="Milestone" options={facets.milestones} value={f.milestones} onChange={(v) => set('milestones', v)} width={300} />
            <DateFilter label="Published" value={f.published} onChange={(v) => set('published', v)} marks={facets.marks} minYear={facets.minYear} />
          </FilterRow>
          {driftActive(f) && rows.length === 0 ? (
            <NoMatches onClear={clear}>No forecast update matches these filters.</NoMatches>
          ) : view === 'chart' ? (
            charted.length === 0 ? (
              driftActive(f) ? (
                <NoMatches onClear={clear}>The matching updates are for milestones the chart doesn’t plot. See the table.</NoMatches>
              ) : (
                <EmptyState title="Nothing to chart">None of the updates name automated coder, superhuman AI researcher, ASI or TED-AI. See the table.</EmptyState>
              )
            ) : (
              <>
                <div className="mb-2">
                  <Legend items={legendItems} />
                </div>
                <EChart option={option} height={380} ariaLabel="Authors' median forecast dates plotted against publication date" />
              </>
            )
          ) : (
            <div className="max-h-[440px] overflow-auto rounded-xl border border-line">
              <table className="w-full min-w-[640px] text-[12.5px]">
                <thead className="sticky top-0 bg-surface-2 text-left">
                  <tr className="kicker">
                    <SortTh k="milestone" sort={sort} onSort={onSort}>
                      Milestone
                    </SortTh>
                    <SortTh k="forecaster" sort={sort} onSort={onSort}>
                      Forecaster
                    </SortTh>
                    <SortTh k="published" sort={sort} onSort={onSort}>
                      Published
                    </SortTh>
                    <SortTh k="median" sort={sort} onSort={onSort}>
                      Median
                    </SortTh>
                    <SortTh k="out" sort={sort} onSort={onSort} className="text-right">
                      Years out
                    </SortTh>
                    <th className="px-3 py-2 font-normal">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={full.rows.indexOf(r)} className="border-t border-line align-top">
                      <td className="px-3 py-1.5 text-ink">
                        {r.key && (
                          <span aria-hidden className="mr-1.5 text-[10px]" style={{ color: colorOf(r.key) }}>
                            ■
                          </span>
                        )}
                        {r.key ? MILESTONE_META[r.key].label : r.milestone}
                      </td>
                      <td className="px-3 py-1.5 text-ink-2">{r.forecaster}</td>
                      <td className="tnum px-3 py-1.5 text-ink-2">{shortDate(r.published)}</td>
                      <td className="tnum px-3 py-1.5 font-medium text-ink">{monthYear(r.median)}</td>
                      <td className="tnum px-3 py-1.5 text-right text-ink-2">{yearsOut(r).toFixed(1)}</td>
                      <td className="px-3 py-1.5 text-ink-3">{r.url ? <ExtLink href={r.url}>{hostOf(r.url)}</ExtLink> : '—'}</td>
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
