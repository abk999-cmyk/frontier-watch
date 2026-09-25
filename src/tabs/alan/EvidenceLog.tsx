import { AnimatePresence, motion } from 'motion/react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ActiveFilters, DateFilter, MultiSelect, MultiSelectList, RangePanel, SearchInput, SingleSelect, ToggleFilter, type ActivePill, type Option } from '../../components/filters/Filters.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { useAlan } from '../../lib/data.ts';
import { ANY_DATE, isDateActive, isRangeActive, summarizeDate } from '../../lib/filters.ts';
import { monthYear } from '../../lib/format.ts';
import { LAB_META, labVar } from '../../lib/labs.ts';
import {
  activeFeedFilterCount,
  buildFeed,
  EMPTY_FEED_FILTERS,
  feedFacets,
  feedStats,
  filterFeed,
  groupByMonth,
  histogramAxis,
  LAB_BY_KEY,
  LAB_DEFS,
  LAB_KIND_ORDER,
  monthHistogram,
  PHASE_LABEL,
  pickBin,
  SOURCE_LABEL,
  sortFeed,
  TYPE_LABEL,
  type EntryType,
  type FeedEntry,
  type FeedFilters,
  type FeedSort,
  type HistBin,
  type IndicatorRef,
  type Source,
} from './feedModel.ts';
import { MonthHistogram } from './MonthHistogram.tsx';
import { ClampText, EmptyResults, FilterLayout, Highlight, RailField, RailGroup, StatRow, STATUS_META, useHeaderOffset, useSlashFocus } from './ui.tsx';

const PAGE = 30;
type Density = 'comfortable' | 'compact';
type ListKey = 'sources' | 'types' | 'indicators' | 'phases' | 'statuses' | 'itypes' | 'labs' | 'hosts';

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLong = (key: string) => `${MONTHS_LONG[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const TYPE_KICKER: Record<EntryType, string> = { 'agi-pct': 'AGI countdown', 'agi-info': 'AGI note', asi: 'ASI checklist' };
const SORTS: { value: FeedSort; label: string; hint?: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'delta', label: 'Largest Δ', hint: 'AGI % jumps, then ASI changes' },
];

/** Alan's AGI countdown log + ASI evidence log, merged, filterable, grouped by month. */
export function EvidenceLog() {
  const { agi, asi } = useAlan();
  const entries = useMemo(() => buildFeed(agi, asi), [agi, asi]);
  const axis = useMemo(() => histogramAxis(entries.map((e) => e.date), 60), [entries]);
  const marks = useMemo(() => new Set(entries.map((e) => e.date)), [entries]);
  const minYear = useMemo(() => Number((entries.at(-1)?.date ?? '2017').slice(0, 4)), [entries]);
  const pctDomain = useMemo<[number, number]>(() => {
    const p = entries.flatMap((e) => (e.pct === null ? [] : [e.pct]));
    return p.length ? [Math.min(...p), Math.max(...p)] : [0, 100];
  }, [entries]);

  const [f, setF] = useState<FeedFilters>(EMPTY_FEED_FILTERS);
  const [sort, setSort] = useState<FeedSort>('newest');
  const [density, setDensity] = useState<Density>('comfortable');
  const [limit, setLimit] = useState(PAGE);
  const searchRef = useRef<HTMLDivElement>(null);
  useSlashFocus(searchRef);
  const top = useHeaderOffset();

  const patch = useCallback((p: Partial<FeedFilters>) => {
    setF((prev) => ({ ...prev, ...p }));
    setLimit(PAGE);
  }, []);
  const toggle = useCallback((key: ListKey, v: string) => {
    setF((prev) => ({ ...prev, [key]: prev[key].includes(v) ? prev[key].filter((x) => x !== v) : [...prev[key], v] }));
    setLimit(PAGE);
  }, []);
  const onIndicator = useCallback((id: string) => toggle('indicators', id), [toggle]);
  const onLab = useCallback((k: string) => toggle('labs', k), [toggle]);
  const clearAll = useCallback(() => {
    setF(EMPTY_FEED_FILTERS);
    setLimit(PAGE);
  }, []);

  const filtered = useMemo(() => sortFeed(filterFeed(entries, f), sort), [entries, f, sort]);
  const facets = useMemo(() => feedFacets(entries, f), [entries, f]);
  const hist = useMemo(() => (axis ? monthHistogram(filterFeed(entries, f, 'date'), axis) : null), [entries, f, axis]);
  const stats = useMemo(() => feedStats(filtered), [filtered]);
  const monthCounts = useMemo(() => {
    const m = new Map<string, { n: number; moved: number }>();
    for (const e of filtered) {
      const c = m.get(e.month) ?? { n: 0, moved: 0 };
      c.n++;
      if (e.moved) c.moved++;
      m.set(e.month, c);
    }
    return m;
  }, [filtered]);

  /* ── options (stable order, live counts) ── */
  const items = asi.items ?? [];
  const cnt = (m: Map<string, number>, v: string) => m.get(v) ?? 0;
  const sourceOpts: Option[] = (['agi', 'asi'] as Source[]).map((s) => ({ value: s, label: SOURCE_LABEL[s], count: cnt(facets.sources, s) }));
  const typeOpts: Option[] = (['agi-pct', 'agi-info', 'asi'] as EntryType[]).map((t) => ({ value: t, label: TYPE_LABEL[t], count: cnt(facets.types, t) }));
  const indicatorOpts: Option[] = [...items]
    .sort((a, b) => a.phase - b.phase || a.id - b.id)
    .map((i) => ({ value: String(i.id), label: `#${i.id} · ${i.keyword || i.label}`, count: cnt(facets.indicators, String(i.id)), group: `Phase ${i.phase} · ${PHASE_LABEL[i.phase]}`, color: STATUS_META[i.status].color, glyph: STATUS_META[i.status].icon }));
  const phaseOpts: Option[] = [1, 2, 3].map((p) => ({ value: String(p), label: `${p} · ${PHASE_LABEL[p]}`, count: cnt(facets.phases, String(p)) }));
  const statusOpts: Option[] = (['achieved', 'partial'] as const).map((s) => ({ value: s, label: STATUS_META[s].label, count: cnt(facets.statuses, s), color: STATUS_META[s].color, glyph: STATUS_META[s].icon }));
  const itypeOpts: Option[] = [...new Set(items.map((i) => i.type).filter(Boolean))].sort().map((t) => ({ value: t, label: t, count: cnt(facets.itypes, t) }));
  const labTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) for (const k of e.labs) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  }, [entries]);
  const labOpts: Option[] = LAB_DEFS.filter((d) => labTotals.has(d.key))
    .sort((a, b) => LAB_KIND_ORDER.indexOf(a.kind) - LAB_KIND_ORDER.indexOf(b.kind) || labTotals.get(b.key)! - labTotals.get(a.key)!)
    .map((d) => ({ value: d.key, label: d.label, count: cnt(facets.labs, d.key), group: d.kind, color: labVar(d.group), glyph: LAB_META[d.group].glyph }));
  const hostTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) for (const h of e.hosts) m.set(h, (m.get(h) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [entries]);
  const hostOpts: Option[] = hostTotals.map(([h]) => ({ value: h, label: h, count: cnt(facets.hosts, h) }));

  /* ── active pills ── */
  const labelOf: Record<ListKey, (v: string) => string> = {
    sources: (v) => SOURCE_LABEL[v as Source] ?? v,
    types: (v) => TYPE_LABEL[v as EntryType] ?? v,
    indicators: (v) => {
      const it = items.find((i) => String(i.id) === v);
      return it ? `#${v} ${it.keyword || it.label}` : `#${v}`;
    },
    phases: (v) => `Phase ${v}`,
    statuses: (v) => STATUS_META[v as 'achieved' | 'partial']?.label ?? v,
    itypes: (v) => `Type: ${v}`,
    labs: (v) => LAB_BY_KEY.get(v)?.label ?? v,
    hosts: (v) => v,
  };
  const PREFIX: Record<ListKey, string> = { sources: 'Sources', types: 'Entry types', indicators: 'Indicators', phases: 'Phases', statuses: 'Statuses', itypes: 'Indicator types', labs: 'Mentions', hosts: 'Domains' };
  const pills: ActivePill[] = [];
  if (f.q.trim()) pills.push({ key: 'q', label: `“${f.q.trim()}”`, onClear: () => patch({ q: '' }) });
  if (isDateActive(f.date)) pills.push({ key: 'date', label: summarizeDate(f.date), onClear: () => patch({ date: ANY_DATE }) });
  if (f.moved) pills.push({ key: 'moved', label: '▲ Moved the needle', onClear: () => patch({ moved: false }) });
  if (isRangeActive(f.pct)) pills.push({ key: 'pct', label: `AGI ${f.pct.min ?? pctDomain[0]}–${f.pct.max ?? pctDomain[1]}%`, onClear: () => patch({ pct: {} }) });
  for (const k of ['sources', 'types', 'indicators', 'phases', 'statuses', 'itypes', 'labs', 'hosts'] as ListKey[]) {
    const vals = f[k];
    if (vals.length > 3) pills.push({ key: k, label: `${PREFIX[k]}: ${vals.length}`, onClear: () => patch({ [k]: [] }) });
    else for (const v of vals) pills.push({ key: `${k}:${v}`, label: labelOf[k](v), onClear: () => toggle(k, v) });
  }
  if (f.hasLinks) pills.push({ key: 'links', label: 'Has links', onClear: () => patch({ hasLinks: false }) });

  const activeCount = activeFeedFilterCount(f);
  const selIndicators = useMemo(() => new Set(f.indicators), [f.indicators]);
  const selLabs = useMemo(() => new Set(f.labs), [f.labs]);
  const onPickBin = useCallback((bin: HistBin, extend: boolean) => {
    setF((prev) => ({ ...prev, date: pickBin(prev.date, bin, extend) }));
    setLimit(PAGE);
  }, []);

  const shown = filtered.slice(0, limit);
  const groups = sort === 'delta' ? null : groupByMonth(shown);
  const compact = density === 'compact';

  const rail = (
    <>
      <RailGroup label="Impact" hint="AGI: the % rose vs the previous % entry. ASI: an indicator got its first evidence or became achieved.">
        <ToggleFilter
          value={f.moved}
          onChange={(v) => patch({ moved: v })}
          label={
            <>
              Moved the needle only <span className="font-mono text-[11px] text-ink-3 tnum">{facets.moved}</span>
            </>
          }
        />
      </RailGroup>
      <RailGroup label="Date" hint="Alan logs entries by month. Or click the monthly bars.">
        <RailField>
          <DateFilter value={f.date} onChange={(v) => patch({ date: v })} marks={marks} minYear={minYear} />
        </RailField>
      </RailGroup>
      <RailGroup label="Source">
        <MultiSelectList options={sourceOpts} value={f.sources} onChange={(v) => patch({ sources: v })} searchable={false} />
      </RailGroup>
      <RailGroup label="Entry type">
        <MultiSelectList options={typeOpts} value={f.types} onChange={(v) => patch({ types: v })} searchable={false} />
      </RailGroup>
      <RailGroup label="AGI countdown %" hint="Only AGI % entries have a value, so this hides everything else.">
        <div className="[&_input[type=number]]:w-[64px]">
          <RangePanel domain={pctDomain} value={f.pct} onChange={(v) => patch({ pct: v })} format={(n) => `${n}%`} />
        </div>
      </RailGroup>
      <RailGroup label="ASI indicator" hint="Tip: click an indicator chip on any entry.">
        <RailField>
          <MultiSelect label="Indicators" options={indicatorOpts} value={f.indicators} onChange={(v) => patch({ indicators: v })} width={360} />
        </RailField>
      </RailGroup>
      <RailGroup label="ASI phase">
        <MultiSelectList options={phaseOpts} value={f.phases} onChange={(v) => patch({ phases: v })} searchable={false} />
      </RailGroup>
      <RailGroup label="ASI status in entry">
        <MultiSelectList options={statusOpts} value={f.statuses} onChange={(v) => patch({ statuses: v })} searchable={false} />
      </RailGroup>
      <RailGroup label="Indicator type" hint="Phase, status and type must match the same indicator.">
        <MultiSelectList options={itypeOpts} value={f.itypes} onChange={(v) => patch({ itypes: v })} searchable={false} />
      </RailGroup>
      <RailGroup label="Labs & companies mentioned" hint="Detected from names in the title and summary (GPT → OpenAI, Gemini → Google…).">
        <RailField>
          <MultiSelect label="Mentions" options={labOpts} value={f.labs} onChange={(v) => patch({ labs: v })} width={320} />
        </RailField>
      </RailGroup>
      <RailGroup label="Links">
        <div className="space-y-2">
          <RailField>
            <MultiSelect label="Link domain" options={hostOpts} value={f.hosts} onChange={(v) => patch({ hosts: v })} width={320} />
          </RailField>
          <ToggleFilter
            value={f.hasLinks}
            onChange={(v) => patch({ hasLinks: v })}
            label={
              <>
                Has links <span className="font-mono text-[11px] text-ink-3 tnum">{facets.hasLinks}</span>
              </>
            }
          />
        </div>
      </RailGroup>
    </>
  );

  const toolbar = (
    <>
      <div
        ref={searchRef}
        className="min-w-0 flex-[1_1_220px]"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && f.q) (patch({ q: '' }), e.stopPropagation());
        }}
      >
        <SearchInput value={f.q} onChange={(q) => patch({ q })} placeholder="Search titles, summaries, links…   /" className="w-full" />
      </div>
      <SingleSelect label="Sort" value={sort} onChange={(v) => (setSort(v), setLimit(PAGE))} options={SORTS} defaultValue="newest" />
      <Segmented
        label="Density"
        value={density}
        onChange={setDensity}
        options={[
          { value: 'comfortable', label: 'Comfortable', title: 'Titles, summaries and links' },
          { value: 'compact', label: 'Compact', title: 'One line per entry' },
        ]}
      />
    </>
  );

  return (
    <div>
      <StatRow
        items={[
          { value: stats.total, label: stats.total === entries.length ? 'entries' : `of ${entries.length} entries` },
          { value: stats.agiMoves, label: 'AGI countdown moves' },
          { value: stats.asiStatusChanges, label: 'ASI status changes', sub: stats.indicatorChanges ? `${stats.indicatorChanges} indicator steps` : undefined },
          { value: stats.first && stats.last ? `${monthYear(stats.first)} – ${monthYear(stats.last)}` : '—', label: 'span', text: true },
        ]}
      />

      <div className="mt-8">
        <FilterLayout rail={rail} railLabel="Evidence log filters" activeCount={activeCount} onClearAll={clearAll} resultLabel={`${filtered.length} entries`} toolbar={toolbar}>
          {hist && (
            <div className="mt-5">
              <MonthHistogram bins={hist.bins} earlier={hist.earlier} date={f.date} onPick={onPickBin} />
            </div>
          )}
          <div className="mt-5 min-h-[26px]">
            <ActiveFilters pills={pills} onClearAll={clearAll} count={filtered.length} total={entries.length} noun="entries" />
          </div>

          <div className="mt-3">
            {filtered.length === 0 ? (
              <EmptyResults noun="entries" onClear={clearAll} hint="Widen the date range or drop a filter. Filters on AGI-only or ASI-only fields hide entries from the other log." />
            ) : groups ? (
              <div className="relative">
                <AnimatePresence initial={false} mode="popLayout">
                  {groups.map((g) => {
                    const c = monthCounts.get(g.month);
                    return (
                      <motion.section key={g.month} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} aria-labelledby={`ev-${g.month}`}>
                        <h3
                          id={`ev-${g.month}`}
                          className="sticky z-10 -mx-2 flex items-baseline justify-between gap-3 border-b border-line bg-[color-mix(in_oklab,var(--bg)_76%,transparent)] px-2 py-2.5 backdrop-blur-md"
                          style={{ top }}
                        >
                          <span className="text-[13px] font-semibold tracking-tight text-ink">{monthLong(g.month)}</span>
                          <span className="font-mono text-[11px] text-ink-3 tnum">
                            {c?.n ?? g.entries.length} {c?.n === 1 ? 'entry' : 'entries'}
                            {c?.moved ? (
                              <>
                                {' '}
                                · <span className="text-accent">▲</span> {c.moved} moved
                              </>
                            ) : null}
                          </span>
                        </h3>
                        <ol className={`relative ml-1 border-l border-line ${compact ? 'pb-3 pt-1' : 'pb-6 pt-2'}`}>
                          <AnimatePresence initial={false} mode="popLayout">
                            {g.entries.map((e) => (
                              <EntryItem key={e.id} e={e} q={f.q} compact={compact} showDate={false} selIndicators={selIndicators} selLabs={selLabs} onIndicator={onIndicator} onLab={onLab} />
                            ))}
                          </AnimatePresence>
                        </ol>
                      </motion.section>
                    );
                  })}
                </AnimatePresence>
              </div>
            ) : (
              <ol className="relative ml-1 border-l border-line pt-2">
                <AnimatePresence initial={false} mode="popLayout">
                  {shown.map((e) => (
                    <EntryItem key={e.id} e={e} q={f.q} compact={compact} showDate selIndicators={selIndicators} selLabs={selLabs} onIndicator={onIndicator} onLab={onLab} />
                  ))}
                </AnimatePresence>
              </ol>
            )}

            {filtered.length > limit && (
              <div className="mt-4 flex flex-wrap items-center gap-3 pl-5">
                <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="rounded-full border border-line-2 bg-surface-2/60 px-4 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-[var(--accent)]">
                  Show {Math.min(PAGE, filtered.length - limit)} more
                </button>
                <button type="button" onClick={() => setLimit(Number.POSITIVE_INFINITY)} className="text-[12px] text-ink-3 underline decoration-line-2 underline-offset-2 hover:text-ink">
                  Show all {filtered.length}
                </button>
                <span className="font-mono text-[11px] text-ink-3 tnum">
                  {limit} / {filtered.length}
                </span>
              </div>
            )}
          </div>
        </FilterLayout>
      </div>
    </div>
  );
}

/* ───────────────────────────── pieces ───────────────────────────── */

function Dot({ e, compact }: { e: FeedEntry; compact: boolean }) {
  const base = `absolute -left-[5px] h-[9px] w-[9px] ${compact ? 'top-[14px]' : 'top-[21px]'}`;
  if (e.type === 'agi-info') return <span aria-hidden className={`${base} rounded-full border border-ink-3 bg-bg`} />;
  if (e.type === 'agi-pct')
    return <span aria-hidden className={`${base} rounded-full ${e.moved ? 'bg-accent shadow-[0_0_0_3px_var(--accent-soft),0_0_14px_-2px_var(--accent)]' : 'bg-[color-mix(in_oklab,var(--accent)_45%,var(--bg))]'}`} />;
  return <span aria-hidden className={`${base} rotate-45 rounded-[2px] ${e.moved ? 'bg-ink shadow-[0_0_0_3px_color-mix(in_oklab,var(--text)_14%,transparent)]' : 'border border-ink-3 bg-bg'}`} />;
}

const BADGE = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[11px] tnum';
const HOT = 'border-[color-mix(in_oklab,var(--accent)_50%,transparent)] bg-[var(--accent-soft)] text-ink';
const COLD = 'border-line text-ink-3';

function DeltaBadge({ e }: { e: FeedEntry }) {
  if (e.type === 'agi-pct') {
    if (e.delta === null)
      return (
        <span className={`${BADGE} ${COLD}`} title="First % entry in Alan's log">
          start · {e.pct}%
        </span>
      );
    if (e.delta > 0)
      return (
        <span className={`${BADGE} ${HOT}`} title={`Up ${e.delta} point${e.delta === 1 ? '' : 's'} from the previous % entry`}>
          <span aria-hidden className="text-accent">
            ▲
          </span>
          {e.prevPct} → {e.pct}%<span className="sr-only">, up {e.delta} points</span>
        </span>
      );
    if (e.delta < 0)
      return (
        <span className={`${BADGE} border-line-2 text-ink`} title={`Down ${-e.delta} from the previous % entry`}>
          <span aria-hidden>▼</span>
          {e.prevPct} → {e.pct}%
        </span>
      );
    return (
      <span className={`${BADGE} ${COLD}`} title="Same % as the previous entry">
        held at {e.pct}%
      </span>
    );
  }
  if (e.asiChange === 'status')
    return (
      <span className={`${BADGE} ${HOT}`} title="An indicator got its first evidence or became achieved">
        <span aria-hidden className="text-accent">
          ▲
        </span>
        status change
      </span>
    );
  if (e.asiChange === 'evidence')
    return (
      <span className={`${BADGE} ${COLD}`} title="Adds evidence to indicators that already had some">
        more evidence
      </span>
    );
  return null;
}

function IndicatorChip({ i, selected, onClick }: { i: IndicatorRef; selected: boolean; onClick: (id: string) => void }) {
  const s = STATUS_META[i.status];
  const change = i.change === 'achieved' ? 'now achieved' : i.change === 'first' ? 'first evidence' : null;
  return (
    <button
      type="button"
      onClick={() => onClick(String(i.id))}
      aria-pressed={selected}
      title={`#${i.id} ${i.label} · ${s.label}${change ? ` (${change})` : ''}. Click to ${selected ? 'remove the filter' : 'filter to this indicator'}.`}
      className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
        selected ? 'border-[color-mix(in_oklab,var(--accent)_55%,transparent)] bg-[var(--accent-soft)] text-ink' : 'border-line bg-surface-2/50 text-ink-2 hover:border-line-2 hover:text-ink'
      }`}
    >
      <span aria-hidden style={{ color: s.color }}>
        {s.icon}
      </span>
      <span className="sr-only">{s.label}</span>
      <span className="font-mono text-[10.5px] text-ink-3">#{i.id}</span>
      <span className="min-w-0 truncate">{i.keyword}</span>
      {change && <span className="whitespace-nowrap font-medium text-ink">· {change}</span>}
    </button>
  );
}

interface EntryProps {
  e: FeedEntry;
  q: string;
  compact: boolean;
  showDate: boolean;
  selIndicators: Set<string>;
  selLabs: Set<string>;
  onIndicator: (id: string) => void;
  onLab: (key: string) => void;
}

const EntryItem = memo(function EntryItem({ e, q, compact, showDate, selIndicators, selLabs, onIndicator, onLab }: EntryProps) {
  const [open, setOpen] = useState(false);
  const [allLinks, setAllLinks] = useState(false);
  const full = !compact || open;
  const chipCap = full ? 12 : 3;
  const links = allLinks ? e.links : e.links.slice(0, 4);
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="relative pl-4 sm:pl-5"
    >
      <Dot e={e} compact={compact} />
      <article className={`rounded-2xl px-3 transition-colors [overflow-wrap:anywhere] hover:bg-surface-2/55 sm:px-4 ${compact ? 'py-2' : 'py-3.5'}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {showDate && <span className="font-mono text-[11px] text-ink-2">{monthYear(e.date)}</span>}
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">{TYPE_KICKER[e.type]}</span>
          <DeltaBadge e={e} />
          {e.indicators.slice(0, chipCap).map((i) => (
            <IndicatorChip key={i.id} i={i} selected={selIndicators.has(String(i.id))} onClick={onIndicator} />
          ))}
          {e.indicators.length > chipCap && (
            <button type="button" onClick={() => setOpen(true)} className="font-mono text-[11px] text-ink-3 hover:text-ink" title={e.indicators.map((i) => `#${i.id} ${i.keyword}`).join(', ')}>
              +{e.indicators.length - chipCap} more
            </button>
          )}
        </div>

        <div className="mt-1.5 flex items-start gap-2">
          <h4 className={`min-w-0 flex-1 font-semibold leading-snug tracking-tight text-ink ${compact ? 'text-[13.5px]' : 'text-[15px]'} ${full ? '' : 'line-clamp-1'}`}>
            <Highlight text={e.title} q={q} />
          </h4>
          {compact && (
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Collapse entry' : 'Expand entry'} className="mt-0.5 shrink-0 rounded-full border border-line px-1.5 text-[10px] text-ink-3 hover:border-line-2 hover:text-ink">
              <span className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
            </button>
          )}
        </div>

        {full && e.summary && (
          <div className="mt-1.5">
            <ClampText className="text-[13px] leading-relaxed text-ink-2">
              <Highlight text={e.summary} q={q} />
            </ClampText>
          </div>
        )}

        {full && (e.links.length > 0 || e.labs.length > 0) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {links.map((l, j) => (
              <a
                key={`${l.url}-${j}`}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                title={l.url}
                className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-2/40 px-2 py-0.5 text-[11px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
              >
                {l.host && <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{l.host}</span>}
                <span className="min-w-0 truncate">
                  <Highlight text={l.label} q={q} />
                </span>
                <span aria-hidden className="text-ink-3">
                  ↗
                </span>
              </a>
            ))}
            {e.links.length > 4 && !allLinks && (
              <button type="button" onClick={() => setAllLinks(true)} className="font-mono text-[11px] text-ink-3 hover:text-ink">
                +{e.links.length - 4} links
              </button>
            )}
            {e.labs.length > 0 && (
              <span className="ml-1 flex flex-wrap items-center gap-1.5">
                <span className="text-[10.5px] text-ink-3">mentions</span>
                {e.labs.map((k) => {
                  const d = LAB_BY_KEY.get(k);
                  if (!d) return null;
                  const sel = selLabs.has(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => onLab(k)}
                      aria-pressed={sel}
                      title={sel ? `Remove the ${d.label} filter` : `Filter to entries mentioning ${d.label}`}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${sel ? 'border-[color-mix(in_oklab,var(--accent)_55%,transparent)] bg-[var(--accent-soft)] text-ink' : 'border-line text-ink-2 hover:border-line-2 hover:text-ink'}`}
                    >
                      <span aria-hidden className="text-[9px]" style={{ color: labVar(d.group) }}>
                        {LAB_META[d.group].glyph}
                      </span>
                      {d.label}
                    </button>
                  );
                })}
              </span>
            )}
          </div>
        )}
      </article>
    </motion.li>
  );
});
