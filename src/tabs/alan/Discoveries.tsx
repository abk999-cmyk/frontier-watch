import { AnimatePresence, motion } from 'motion/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActiveFilters, DateFilter, MultiSelect, MultiSelectList, RangePanel, SearchInput, SingleSelect, ToggleFilter, type ActivePill, type Option } from '../../components/filters/Filters.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { useAlan, useCharts } from '../../lib/data.ts';
import { addMonths, ANY_DATE, hostOf, isDateActive, isRangeActive, summarizeDate, todayIso, type DateFilterValue } from '../../lib/filters.ts';
import { toTime } from '../../lib/format.ts';
import { LAB_META, labVar } from '../../lib/labs.ts';
import {
  activeDiscFilterCount,
  AUTONOMIES,
  buildDiscoveries,
  discFacets,
  discStats,
  EMPTY_DISC_FILTERS,
  filterDiscoveries,
  fmtDiscDate,
  hash01,
  sortDiscoveries,
  TIER_NAMES,
  UNKNOWN,
  VERIFICATIONS,
  type Autonomy,
  type DiscFacetKey,
  type DiscFilters,
  type Discovery,
  type DiscSortKey,
  type SortDir,
  type SourceFilter,
  type Verification,
} from './discoveriesModel.ts';
import { LAB_BY_KEY, LAB_DEFS, LAB_KIND_ORDER } from './feedModel.ts';
import { ClampText, EmptyResults, FilterLayout, Highlight, RailField, RailGroup, StatRow, useSlashFocus, useWidth } from './ui.tsx';

/* ───────────────────────────── meta ───────────────────────────── */

const VERIF_META: Record<Verification | typeof UNKNOWN, { label: string; glyph: string; color: string; hint: string }> = {
  'formal-proof': { label: 'Formal proof', glyph: '◆', color: 'var(--good)', hint: 'Proof checked in Lean' },
  'peer-reviewed': { label: 'Peer-reviewed', glyph: '✓', color: 'var(--good)', hint: 'Published in a refereed venue' },
  'expert-endorsed': { label: 'Expert-endorsed', glyph: '▲', color: 'var(--text-2)', hint: 'Independent experts accepted it; not yet refereed' },
  claimed: { label: 'Claimed', glyph: '○', color: 'var(--warn)', hint: 'Reported by the authors; nobody has checked it yet' },
  disputed: { label: 'Disputed', glyph: '✕', color: 'var(--critical)', hint: 'Substantive public objections are unresolved' },
  unknown: { label: 'Not graded', glyph: '?', color: 'var(--text-3)', hint: "From Alan's list; not yet in the curated file" },
};
const AUTONOMY_META: Record<Autonomy | typeof UNKNOWN, { label: string; glyph: string; hint: string }> = {
  tool: { label: 'AI as tool', glyph: '◔', hint: 'AI used as an instrument inside a human-directed project' },
  collaborative: { label: 'Human + AI', glyph: '◑', hint: 'Humans and AI iterated together; both contributed core ideas' },
  autonomous: { label: 'AI end-to-end', glyph: '●', hint: 'The AI produced the core result from a problem statement' },
  unknown: { label: 'Autonomy unknown', glyph: '·', hint: 'Not graded' },
};
const DOMAIN_META: Record<string, { label: string; glyph: string }> = {
  math: { label: 'Math', glyph: '◆' },
  science: { label: 'Science', glyph: '●' },
  unknown: { label: 'Unclassified', glyph: '○' },
};
const SOURCE_OPTS: { value: SourceFilter; label: string; title: string }[] = [
  { value: 'any', label: 'All', title: 'Curated and Alan’s list' },
  { value: 'curated', label: 'Curated', title: 'In the curated breakthroughs file' },
  { value: 'alan', label: 'Alan’s', title: "In Alan's discoveries list" },
  { value: 'both', label: 'Both', title: 'In both lists' },
];
const COLS: { key: DiscSortKey; label: string; first: SortDir }[] = [
  { key: 'date', label: 'Date', first: 'desc' },
  { key: 'title', label: 'Discovery', first: 'asc' },
  { key: 'significance', label: 'Significance', first: 'desc' },
  { key: 'verification', label: 'Verification', first: 'desc' },
  { key: 'autonomy', label: 'Autonomy', first: 'desc' },
  { key: 'domain', label: 'Field', first: 'asc' },
  { key: 'org', label: 'Org', first: 'asc' },
  { key: 'model', label: 'Model / system', first: 'asc' },
  { key: 'source', label: 'Source', first: 'asc' },
];
const SORT_PRESETS: { value: string; label: string }[] = [
  { value: 'date:desc', label: 'Newest first' },
  { value: 'date:asc', label: 'Oldest first' },
  { value: 'significance:desc', label: 'Most significant' },
  { value: 'org:asc', label: 'Org A–Z' },
];
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type View = 'cards' | 'table';
type ListKey = DiscFacetKey;

/** Curated breakthroughs + Alan's discoveries list: filterable cards / table with a significance timeline. */
export function Discoveries() {
  const charts = useCharts();
  const { asi } = useAlan();
  const all = useMemo(() => buildDiscoveries(charts?.breakthroughs, asi?.discoveries), [charts, asi]);
  const marks = useMemo(() => new Set(all.flatMap((d) => (d.date ? [d.date] : []))), [all]);

  const [f, setF] = useState<DiscFilters>(EMPTY_DISC_FILTERS);
  const [sort, setSort] = useState<{ key: DiscSortKey; dir: SortDir }>({ key: 'date', dir: 'desc' });
  const [view, setView] = useState<View>('cards');
  const [flash, setFlash] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  useSlashFocus(searchRef);

  const patch = useCallback((p: Partial<DiscFilters>) => setF((prev) => ({ ...prev, ...p })), []);
  const toggle = useCallback((key: ListKey, v: string) => setF((prev) => ({ ...prev, [key]: prev[key].includes(v) ? prev[key].filter((x) => x !== v) : [...prev[key], v] })), []);
  const clearAll = useCallback(() => setF(EMPTY_DISC_FILTERS), []);

  const filtered = useMemo(() => sortDiscoveries(filterDiscoveries(all, f), sort.key, sort.dir), [all, f, sort]);
  const facets = useMemo(() => discFacets(all, f), [all, f]);
  const stats = useMemo(() => discStats(filtered), [filtered]);
  const visible = useMemo(() => new Set(filtered.map((d) => d.id)), [filtered]);

  // Timeline dot → scroll to its card/row and flash it.
  const flashTimer = useRef<number | undefined>(undefined);
  const pick = useCallback((id: string) => {
    setFlash(id);
    requestAnimationFrame(() => document.querySelector(`[data-disc="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' }));
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1800);
  }, []);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  /* ── options: stable order from the whole list, live counts from facets ── */
  const totals = useMemo(() => {
    const t = {} as Record<ListKey, [string, number][]>;
    for (const k of ['fields', 'orgs', 'models', 'tags', 'problems', 'labs'] as ListKey[]) {
      const m = new Map<string, number>();
      for (const d of all) {
        const vals = k === 'fields' ? (d.field ? [d.field] : []) : k === 'problems' ? (d.problem ? [d.problem] : []) : k === 'labs' ? (d.labs.length ? d.labs : ['none']) : k === 'orgs' ? d.orgs : k === 'models' ? d.models : d.tags;
        for (const v of new Set(vals)) m.set(v, (m.get(v) ?? 0) + 1);
      }
      t[k] = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }
    return t;
  }, [all]);
  const cnt = (k: ListKey, v: string) => facets[k].get(v) ?? 0;
  const simple = (k: ListKey): Option[] => (totals[k] ?? []).map(([v]) => ({ value: v, label: v, count: cnt(k, v) }));
  const domainOpts: Option[] = ['math', 'science', UNKNOWN].filter((v) => v !== UNKNOWN || all.some((d) => !d.domain)).map((v) => ({ value: v, label: DOMAIN_META[v].label, count: cnt('domains', v), glyph: DOMAIN_META[v].glyph, color: 'var(--text-2)' }));
  const verifOpts: Option[] = [...VERIFICATIONS, UNKNOWN].filter((v) => v !== UNKNOWN || all.some((d) => !d.verification)).map((v) => ({ value: v, label: VERIF_META[v as Verification].label, count: cnt('verifs', v), glyph: VERIF_META[v as Verification].glyph, color: VERIF_META[v as Verification].color }));
  const autonomyOpts: Option[] = [...AUTONOMIES, UNKNOWN].filter((v) => v !== UNKNOWN || all.some((d) => !d.autonomy)).map((v) => ({ value: v, label: AUTONOMY_META[v as Autonomy].label, count: cnt('autonomies', v), glyph: AUTONOMY_META[v as Autonomy].glyph, color: 'var(--text-2)' }));
  const labOpts: Option[] = (totals.labs ?? [])
    .map(([v]) => ({ v, def: LAB_BY_KEY.get(v) }))
    .sort((a, b) => (a.def ? LAB_KIND_ORDER.indexOf(a.def.kind) : 99) - (b.def ? LAB_KIND_ORDER.indexOf(b.def.kind) : 99) || LAB_DEFS.indexOf(a.def!) - LAB_DEFS.indexOf(b.def!))
    .map(({ v, def }) => (def ? { value: v, label: def.label, count: cnt('labs', v), group: def.kind, color: labVar(def.group), glyph: LAB_META[def.group].glyph } : { value: v, label: 'No frontier lab detected', count: cnt('labs', v), group: 'Other' }));

  /* ── pills ── */
  const labelOf = (k: ListKey, v: string): string => {
    if (k === 'domains') return DOMAIN_META[v]?.label ?? v;
    if (k === 'verifs') return VERIF_META[v as Verification]?.label ?? v;
    if (k === 'autonomies') return AUTONOMY_META[v as Autonomy]?.label ?? v;
    if (k === 'labs') return v === 'none' ? 'No frontier lab' : (LAB_BY_KEY.get(v)?.label ?? v);
    return v;
  };
  const PREFIX: Record<ListKey, string> = { domains: 'Domains', fields: 'Fields', verifs: 'Verification', autonomies: 'Autonomy', orgs: 'Orgs', labs: 'Labs', models: 'Models', tags: 'Tags', problems: 'Problems' };
  const pills: ActivePill[] = [];
  if (f.q.trim()) pills.push({ key: 'q', label: `“${f.q.trim()}”`, onClear: () => patch({ q: '' }) });
  if (isDateActive(f.date)) pills.push({ key: 'date', label: summarizeDate(f.date), onClear: () => patch({ date: ANY_DATE }) });
  if (isRangeActive(f.sig)) {
    const lo = f.sig.min ?? 0;
    const hi = f.sig.max ?? 5;
    pills.push({ key: 'sig', label: lo === hi ? `Significance ${lo} · ${TIER_NAMES[lo]}` : hi === 5 ? `Significance ≥ ${lo} · ${TIER_NAMES[lo]}+` : `Significance ${lo}–${hi}`, onClear: () => patch({ sig: {} }) });
  }
  if (f.source !== 'any') pills.push({ key: 'source', label: `Source: ${SOURCE_OPTS.find((o) => o.value === f.source)?.title}`, onClear: () => patch({ source: 'any' }) });
  if (f.hasProblem) pills.push({ key: 'hasProblem', label: 'Has a named problem', onClear: () => patch({ hasProblem: false }) });
  for (const k of ['domains', 'fields', 'verifs', 'autonomies', 'orgs', 'labs', 'models', 'tags', 'problems'] as ListKey[]) {
    const vals = f[k];
    if (vals.length > 3) pills.push({ key: k, label: `${PREFIX[k]}: ${vals.length}`, onClear: () => patch({ [k]: [] }) });
    else for (const v of vals) pills.push({ key: `${k}:${v}`, label: labelOf(k, v), onClear: () => toggle(k, v) });
  }

  const sortValue = `${sort.key}:${sort.dir}`;
  const sortOpts = SORT_PRESETS.some((o) => o.value === sortValue) ? SORT_PRESETS : [...SORT_PRESETS, { value: sortValue, label: `${COLS.find((c) => c.key === sort.key)?.label} ${sort.dir === 'asc' ? '↑' : '↓'}` }];
  const onSortCol = useCallback((key: DiscSortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: COLS.find((c) => c.key === key)!.first })), []);
  const onFilter = useCallback((k: ListKey, v: string) => toggle(k, v), [toggle]);

  const hasTags = (totals.tags ?? []).length > 0;
  const hasProblems = (totals.problems ?? []).length > 0;

  const rail = (
    <>
      <RailGroup label="Source list" hint={`Alan's rows referenced by a curated entry are merged into it. ${facets.sources.both} of them are in both.`}>
        <Segmented label="Source list" value={f.source} onChange={(v) => patch({ source: v })} options={SOURCE_OPTS.map((o) => ({ ...o, title: `${o.title} (${facets.sources[o.value]})` }))} />
      </RailGroup>
      <RailGroup label="Date">
        <RailField>
          <DateFilter value={f.date} onChange={(v) => patch({ date: v })} marks={marks} />
        </RailField>
      </RailGroup>
      <RailGroup
        label="Significance"
        hint={
          <>
            {TIER_NAMES.map((n, i) => (
              <span key={n} className="whitespace-nowrap">
                <span className="font-mono text-ink-2">{i}</span> {n}
                {i < 5 ? ' · ' : ''}
              </span>
            ))}
            . Ungraded rows drop out when this is set.
          </>
        }
      >
        <div className="[&_input[type=number]]:w-[64px]">
          <RangePanel domain={[0, 5]} value={f.sig} onChange={(v) => patch({ sig: v })} />
        </div>
        <div className="mt-1.5 text-[12px] text-ink-2">
          {TIER_NAMES[f.sig.min ?? 0]} <span className="text-ink-3">→</span> {TIER_NAMES[f.sig.max ?? 5]}
        </div>
      </RailGroup>
      <RailGroup label="Domain">
        <MultiSelectList options={domainOpts} value={f.domains} onChange={(v) => patch({ domains: v })} searchable={false} />
      </RailGroup>
      <RailGroup label="Verification">
        <MultiSelectList options={verifOpts} value={f.verifs} onChange={(v) => patch({ verifs: v })} searchable={false} />
      </RailGroup>
      <RailGroup label="Autonomy">
        <MultiSelectList options={autonomyOpts} value={f.autonomies} onChange={(v) => patch({ autonomies: v })} searchable={false} />
      </RailGroup>
      <RailGroup label="Field, org & model">
        <RailField>
          <MultiSelect label="Field" options={simple('fields')} value={f.fields} onChange={(v) => patch({ fields: v })} width={320} />
          <MultiSelect label="AI lab" options={labOpts} value={f.labs} onChange={(v) => patch({ labs: v })} width={300} />
          <MultiSelect label="Org" options={simple('orgs')} value={f.orgs} onChange={(v) => patch({ orgs: v })} width={340} />
          <MultiSelect label="Model / system" options={simple('models')} value={f.models} onChange={(v) => patch({ models: v })} width={320} />
        </RailField>
      </RailGroup>
      {(hasTags || hasProblems) && (
        <RailGroup label="Tags & named problems">
          <div className="space-y-2">
            {hasProblems && (
              <ToggleFilter
                value={f.hasProblem}
                onChange={(v) => patch({ hasProblem: v })}
                label={
                  <>
                    Has a named problem <span className="font-mono text-[11px] text-ink-3 tnum">{facets.hasProblem}</span>
                  </>
                }
              />
            )}
            <RailField>
              {hasProblems && <MultiSelect label="Problem" options={simple('problems')} value={f.problems} onChange={(v) => patch({ problems: v })} width={320} />}
              {hasTags && <MultiSelect label="Tags" options={simple('tags')} value={f.tags} onChange={(v) => patch({ tags: v })} width={300} />}
            </RailField>
          </div>
        </RailGroup>
      )}
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
        <SearchInput value={f.q} onChange={(q) => patch({ q })} placeholder="Search discoveries, orgs, models…   /" className="w-full" />
      </div>
      <SingleSelect
        label="Sort"
        value={sortValue}
        onChange={(v) => {
          const [key, dir] = v.split(':') as [DiscSortKey, SortDir];
          setSort({ key, dir });
        }}
        options={sortOpts}
        defaultValue="date:desc"
      />
      <Segmented
        label="View"
        value={view}
        onChange={setView}
        options={[
          { value: 'cards', label: 'Cards' },
          { value: 'table', label: 'Table' },
        ]}
      />
    </>
  );

  if (!all.length) {
    return (
      <div className="rounded-2xl border border-dashed border-line-2 px-6 py-14 text-center text-[13px] text-ink-3">
        No discoveries yet. Curated file missing or empty: <code>data/curated/breakthroughs.yaml</code> (then run <code>npm run build:data</code>).
      </div>
    );
  }

  return (
    <div>
      <StatRow
        items={[
          { value: stats.total, label: stats.total === all.length ? 'discoveries' : `of ${all.length} discoveries` },
          { value: stats.last12, label: 'in the last 12 months' },
          { value: stats.verified, label: 'verified', sub: 'formal proof or peer review' },
          { value: stats.inAlan, label: "in Alan's list" },
        ]}
      />
      <div className="mt-8">
        <FilterLayout rail={rail} railLabel="Discovery filters" activeCount={activeDiscFilterCount(f)} onClearAll={clearAll} resultLabel={`${filtered.length} discoveries`} toolbar={toolbar}>
          <div className="mt-5">
            <DiscoveryStrip all={all} visible={visible} date={f.date} onPick={pick} />
          </div>
          <div className="mt-4 min-h-[26px]">
            <ActiveFilters pills={pills} onClearAll={clearAll} count={filtered.length} total={all.length} noun="discoveries" />
          </div>
          <div className="mt-3">
            {filtered.length === 0 ? (
              <EmptyResults noun="discoveries" onClear={clearAll} hint="Widen the date range or drop a filter. A significance range hides Alan's ungraded rows." />
            ) : view === 'cards' ? (
              <div className="relative grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                <AnimatePresence initial={false} mode="popLayout">
                  {filtered.map((d) => (
                    <DiscoveryCard key={d.id} d={d} q={f.q} flash={flash === d.id} onFilter={onFilter} />
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              <DiscoveryTable list={filtered} sort={sort} onSort={onSortCol} q={f.q} flash={flash} onFilter={onFilter} />
            )}
          </div>
        </FilterLayout>
      </div>
    </div>
  );
}

/* ───────────────────────────── pieces ───────────────────────────── */

function SigMeter({ s, small = false }: { s: number | null; small?: boolean }) {
  const label = s === null ? 'Unrated' : `${s} · ${TIER_NAMES[Math.round(s)]}`;
  return (
    <span className="inline-flex items-center gap-2" title={s === null ? 'Significance not graded (Alan-only row)' : `Significance ${s} of 5: ${TIER_NAMES[Math.round(s)]}`}>
      <span aria-hidden className="flex items-end gap-[3px]">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={`w-[5px] rounded-[1.5px] ${s === null ? 'border border-dashed border-line-2' : i <= (s ?? 0) ? 'bg-accent' : 'bg-surface-3'}`}
            style={{ height: (small ? 4 : 6) + i * (small ? 1.5 : 2) }}
          />
        ))}
      </span>
      <span className={`whitespace-nowrap ${small ? 'text-[11.5px]' : 'text-[12px]'} ${s === null ? 'text-ink-3' : 'font-medium text-ink'}`}>{label}</span>
    </span>
  );
}

function VerifBadge({ v }: { v: Verification | null }) {
  const m = VERIF_META[v ?? UNKNOWN];
  return (
    <span title={m.hint} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">
      <span aria-hidden style={{ color: m.color }}>
        {m.glyph}
      </span>
      {m.label}
    </span>
  );
}

function AutonomyBadge({ a }: { a: Autonomy | null }) {
  const m = AUTONOMY_META[a ?? UNKNOWN];
  if (!a) return null;
  return (
    <span title={m.hint} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">
      <span aria-hidden className="text-ink-3">
        {m.glyph}
      </span>
      {m.label}
    </span>
  );
}

function LabGlyphs({ labs }: { labs: string[] }) {
  return (
    <>
      {labs.map((k) => {
        const d = LAB_BY_KEY.get(k);
        return d ? (
          <span key={k} aria-hidden title={d.label} className="text-[9px]" style={{ color: labVar(d.group) }}>
            {LAB_META[d.group].glyph}
          </span>
        ) : null;
      })}
    </>
  );
}

const chip = 'inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink';

const DiscoveryCard = memo(function DiscoveryCard({ d, q, flash, onFilter }: { d: Discovery; q: string; flash: boolean; onFilter: (k: ListKey, v: string) => void }) {
  const disputed = d.verification === 'disputed';
  const claimed = d.verification === 'claimed';
  const dom = DOMAIN_META[d.domain ?? UNKNOWN];
  const alanUrl = d.alan.find((r) => r.url && r.url !== d.url)?.url;
  return (
    <motion.article
      layout="position"
      data-disc={d.id}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`relative flex min-w-0 flex-col rounded-2xl border bg-surface/35 p-4 [overflow-wrap:anywhere] transition-[background-color,border-color,box-shadow] duration-300 hover:bg-surface-2/60 ${
        disputed ? 'border-dashed border-[color-mix(in_oklab,var(--critical)_55%,transparent)]' : claimed ? 'border-dashed border-line-2' : 'border-line hover:border-line-2'
      } ${flash ? 'shadow-[0_0_0_2px_var(--accent),0_0_32px_-6px_var(--accent)]' : ''}`}
    >
      <div className="flex items-center justify-between gap-3">
        <SigMeter s={d.significance} />
        <span className="shrink-0 font-mono text-[11px] text-ink-3">{fmtDiscDate(d)}</span>
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11.5px] text-ink-3">
        <span aria-hidden>{dom.glyph}</span>
        <span>{dom.label}</span>
        {d.field && (
          <>
            <span aria-hidden>·</span>
            <button type="button" onClick={() => onFilter('fields', d.field!)} title={`Filter to ${d.field}`} className="min-w-0 truncate hover:text-ink hover:underline">
              {d.field}
            </button>
          </>
        )}
      </div>

      <h4 className="mt-1 text-[15px] font-semibold leading-snug tracking-tight text-ink">
        <Highlight text={d.title} q={q} />
      </h4>

      {d.summary && (
        <div className="mt-1.5">
          <ClampText lines={3} className="text-[12.5px] leading-relaxed text-ink-2">
            <Highlight text={d.summary} q={q} />
          </ClampText>
        </div>
      )}

      {(d.orgs.length > 0 || d.models.length > 0) && (
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-ink-2">
          <LabGlyphs labs={d.labs} />
          {d.orgs.map((o, i) => (
            <span key={o} className="inline-flex min-w-0 items-center">
              {i > 0 && <span className="mr-1.5 text-ink-3">/</span>}
              <button type="button" onClick={() => onFilter('orgs', o)} title={`Filter to ${o}`} className="min-w-0 truncate text-left hover:text-ink hover:underline">
                <Highlight text={o} q={q} />
              </button>
            </span>
          ))}
          {d.models.slice(0, 2).map((m) => (
            <span key={m} className="inline-flex min-w-0 items-center">
              <span className="mr-1.5 text-ink-3">·</span>
              <button type="button" onClick={() => onFilter('models', m)} title={`Filter to ${m}`} className="min-w-0 truncate text-left font-mono text-[11.5px] text-ink-2 hover:text-ink hover:underline">
                <Highlight text={m} q={q} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <VerifBadge v={d.verification} />
        <AutonomyBadge a={d.autonomy} />
        {d.problem && (
          <button type="button" onClick={() => onFilter('problems', d.problem!)} title="Filter to this problem" className={`${chip} border-line-2 text-ink`}>
            <span aria-hidden className="text-ink-3">
              ⌖
            </span>
            <span className="truncate">{d.problem}</span>
          </button>
        )}
        {d.tags.map((t) => (
          <button key={t} type="button" onClick={() => onFilter('tags', t)} title={`Filter to #${t}`} className={chip}>
            <span className="text-ink-3">#</span>
            {t}
          </button>
        ))}
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        {d.alan.length > 0 ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-surface-3/70 px-2 py-0.5 text-[10.5px] text-ink-2"
            title={d.alan.map((r) => `Alan #${r.n}: ${r.discovery} · ${r.model} · ${r.org}`).join('\n')}
          >
            <span aria-hidden>☰</span>
            {d.source === 'alan' ? "Alan's list" : "In Alan's list"} · {d.alan.map((r) => `#${r.n}`).join(', ')}
          </span>
        ) : (
          <span />
        )}
        <span className="flex items-center gap-3">
          {alanUrl && (
            <a href={alanUrl} target="_blank" rel="noreferrer" className="text-[11.5px] text-ink-3 underline decoration-line-2 underline-offset-2 hover:text-ink">
              Alan's source ↗
            </a>
          )}
          {d.url && (
            <a href={d.url} target="_blank" rel="noreferrer" title={d.url} className="inline-flex items-center gap-1 text-[11.5px] text-ink-2 underline decoration-line-2 underline-offset-2 hover:text-ink">
              {hostOf(d.url) || 'Source'} ↗
            </a>
          )}
        </span>
      </div>
    </motion.article>
  );
});

function DiscoveryTable({ list, sort, onSort, q, flash, onFilter }: { list: Discovery[]; sort: { key: DiscSortKey; dir: SortDir }; onSort: (k: DiscSortKey) => void; q: string; flash: string | null; onFilter: (k: ListKey, v: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[1080px] text-[12.5px]">
        <thead className="bg-surface-2/70 text-left text-ink-3">
          <tr>
            {COLS.map((c) => {
              const on = sort.key === c.key;
              return (
                <th key={c.key} scope="col" aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="whitespace-nowrap px-3 py-2 font-medium">
                  <button type="button" onClick={() => onSort(c.key)} className={`inline-flex items-center gap-1 hover:text-ink ${on ? 'text-ink' : ''}`}>
                    {c.label}
                    <span aria-hidden className={`text-[9px] ${on ? 'text-accent' : 'opacity-0'}`}>
                      {sort.dir === 'asc' && on ? '▲' : '▼'}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {list.map((d) => (
            <tr key={d.id} data-disc={d.id} className={`align-top transition-colors duration-300 ${flash === d.id ? 'bg-[var(--accent-soft)]' : 'hover:bg-surface-2/50'}`}>
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11.5px] text-ink-3">{fmtDiscDate(d)}</td>
              <td className="min-w-[260px] max-w-[380px] px-3 py-2.5">
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
                    <Highlight text={d.title} q={q} />
                  </a>
                ) : (
                  <span className="font-medium text-ink">
                    <Highlight text={d.title} q={q} />
                  </span>
                )}
                {d.problem && <div className="mt-0.5 text-[11px] text-ink-3">⌖ {d.problem}</div>}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5">
                <SigMeter s={d.significance} small />
              </td>
              <td className="whitespace-nowrap px-3 py-2.5">
                <VerifBadge v={d.verification} />
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{d.autonomy ? AUTONOMY_META[d.autonomy].label : <span className="text-ink-3">—</span>}</td>
              <td className="px-3 py-2.5 text-ink-2">
                <span className="text-ink-3">{DOMAIN_META[d.domain ?? UNKNOWN].label}</span>
                {d.field && (
                  <>
                    {' · '}
                    <button type="button" onClick={() => onFilter('fields', d.field!)} className="hover:text-ink hover:underline">
                      {d.field}
                    </button>
                  </>
                )}
              </td>
              <td className="max-w-[220px] px-3 py-2.5 text-ink-2">
                <span className="mr-1 inline-flex gap-0.5">
                  <LabGlyphs labs={d.labs} />
                </span>
                {d.orgs.join(' / ') || <span className="text-ink-3">—</span>}
              </td>
              <td className="max-w-[200px] px-3 py-2.5 font-mono text-[11.5px] text-ink-2">{d.models.join(', ') || <span className="font-sans text-ink-3">—</span>}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-ink-3">{d.source === 'curated' ? 'Curated' : d.source === 'alan' ? `Alan #${d.alan.map((r) => r.n).join(', #')}` : `Both · #${d.alan.map((r) => r.n).join(', #')}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────────────────── timeline strip ───────────────────────────── */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const H = 156;
const M = { l: 24, r: 10, t: 10, b: 22 };

/**
 * Overview strip: every discovery as a dot, x = date, y = significance (unrated on its
 * own "?" row). Dots outside the current filters stay faint for context. Zooms to the
 * date filter when one is set. Click a dot to jump to its card or row.
 */
function DiscoveryStrip({ all, visible, date, onPick }: { all: Discovery[]; visible: Set<string>; date: DateFilterValue; onPick: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const w = useWidth(ref);
  const [hover, setHover] = useState<{ d: Discovery; x: number; y: number } | null>(null);

  const geo = useMemo(() => {
    const dated = all.filter((d) => d.date);
    if (!dated.length || w < 40) return null;
    const dates = dated.map((d) => d.date!).sort();
    let lo = dates[0];
    let hi = todayIso() > dates.at(-1)! ? todayIso() : dates.at(-1)!;
    if (isDateActive(date)) {
      if (date.mode !== 'before' && date.from) lo = date.from;
      if (date.mode !== 'after' && date.to) hi = date.to;
      if (hi <= lo) hi = addMonths(lo, 1);
    }
    const pad = (toTime(hi) - toTime(lo)) * 0.02;
    const t0 = toTime(lo) - pad;
    const t1 = toTime(hi) + pad;
    const iw = Math.max(1, w - M.l - M.r);
    const rh = (H - M.t - M.b) / 6;
    const X = (iso: string) => M.l + ((toTime(iso) - t0) / (t1 - t0)) * iw;
    const Y = (d: Discovery) => M.t + (d.significance === null ? 6 : 5 - d.significance) * rh + (hash01(d.id) - 0.5) * rh * 0.55;
    const pts = dated.filter((d) => d.date! >= lo && d.date! <= hi).map((d) => ({ d, x: X(d.date!), y: Y(d), on: visible.has(d.id) }));

    const ticks: { x: number; label: string }[] = [];
    const spanDays = (t1 - t0) / 864e5;
    if (spanDays > 540) {
      const y0 = new Date(t0).getUTCFullYear() + 1;
      const y1 = new Date(t1).getUTCFullYear();
      const every = Math.max(1, Math.ceil(((y1 - y0 + 1) * 40) / iw));
      for (let y = y0; y <= y1; y++) if ((y - y0) % every === 0) ticks.push({ x: X(`${y}-01-01`), label: String(y) });
    } else {
      const start = new Date(t0);
      let k = `${start.getUTCFullYear()}-${String(Math.floor(start.getUTCMonth() / 3) * 3 + 1).padStart(2, '0')}-01`;
      const qs: string[] = [];
      while (toTime(k) <= t1) {
        if (toTime(k) >= t0) qs.push(k);
        k = addMonths(k, spanDays < 120 ? 1 : 3);
      }
      const every = Math.max(1, Math.ceil((qs.length * 52) / iw));
      qs.forEach((q, i) => i % every === 0 && ticks.push({ x: X(q), label: `${MON[Number(q.slice(5, 7)) - 1]} ’${q.slice(2, 4)}` }));
    }
    return { pts, ticks, rh };
  }, [all, visible, date, w]);

  const shape = (p: { d: Discovery; x: number; y: number }, r: number) => {
    const { x, y } = p;
    if (p.d.domain === 'math') return `M${x},${y - r * 1.25}L${x + r * 1.25},${y}L${x},${y + r * 1.25}L${x - r * 1.25},${y}Z`;
    return `M${x - r},${y}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0`;
  };
  const hollow = (d: Discovery) => !d.verification || d.verification === 'claimed' || d.verification === 'disputed';
  const shownCount = geo?.pts.filter((p) => p.on).length ?? 0;

  return (
    <div className="select-none">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[11.5px]">
        <span className="kicker">Timeline · significance by date</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-3">
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="text-[10px] text-ink-2">
              ◆
            </span>
            Math
          </span>
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="text-[10px] text-ink-2">
              ●
            </span>
            Science
          </span>
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="text-[10px] text-ink-2">
              ○
            </span>
            claimed, disputed or ungraded
          </span>
        </span>
      </div>
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        {geo ? (
          <svg width={w} height={H} role="img" aria-label={`Timeline of ${shownCount} discoveries by date and significance. The cards and table below list the same items.`} className="block overflow-visible">
            {[5, 4, 3, 2, 1, 0, -1].map((s, i) => {
              const y = M.t + i * geo.rh;
              return (
                <g key={s}>
                  <line x1={M.l} x2={w - M.r} y1={y} y2={y} stroke="var(--line)" strokeDasharray={s === -1 ? '2 3' : undefined} />
                  <text x={M.l - 8} y={y + 3} textAnchor="end" fontSize={9.5} fontFamily="var(--font-mono)" fill="var(--text-3)">
                    {s === -1 ? '?' : s}
                  </text>
                </g>
              );
            })}
            {geo.ticks.map((t) => (
              <g key={t.label}>
                <line x1={t.x} x2={t.x} y1={M.t} y2={H - M.b + 3} stroke="var(--line)" />
                <text x={t.x + 3} y={H - 6} fontSize={10} fontFamily="var(--font-mono)" fill="var(--text-3)">
                  {t.label}
                </text>
              </g>
            ))}
            {/* context dots first, then the filtered set on top */}
            {geo.pts
              .filter((p) => !p.on)
              .map((p) => (
                <path key={p.d.id} d={shape(p, 3)} fill={hollow(p.d) ? 'none' : 'var(--text-3)'} stroke="var(--text-3)" strokeWidth={1} opacity={0.3} />
              ))}
            {geo.pts
              .filter((p) => p.on)
              .map((p) => {
                const hot = hover?.d.id === p.d.id;
                return (
                  <g key={p.d.id} className="cursor-pointer" onMouseEnter={() => setHover(p)} onClick={() => onPick(p.d.id)}>
                    <circle cx={p.x} cy={p.y} r={8} fill="transparent" />
                    <path
                      d={shape(p, hot ? 5.5 : 4)}
                      fill={hollow(p.d) ? 'var(--bg)' : hot ? 'var(--accent)' : 'var(--text-2)'}
                      stroke={hot ? 'var(--accent)' : 'var(--text-2)'}
                      strokeWidth={1.5}
                      style={{ transition: 'd 120ms ease-out' }}
                    />
                  </g>
                );
              })}
          </svg>
        ) : (
          <div style={{ height: H }} />
        )}
        {hover && geo && (
          <div
            className="pointer-events-none absolute z-10 w-[240px] rounded-xl border border-line-2 bg-surface-2/95 p-2.5 text-[12px] shadow-xl backdrop-blur"
            style={{ left: Math.max(0, Math.min(hover.x - 120, w - 240)), top: hover.y > H / 2 ? hover.y - 12 : hover.y + 14, transform: hover.y > H / 2 ? 'translateY(-100%)' : undefined }}
          >
            <div className="font-mono text-[10.5px] text-ink-3">
              {fmtDiscDate(hover.d)} · {hover.d.significance === null ? 'unrated' : `${hover.d.significance} ${TIER_NAMES[Math.round(hover.d.significance)]}`} · {VERIF_META[hover.d.verification ?? UNKNOWN].label}
            </div>
            <div className="mt-0.5 font-medium leading-snug text-ink">{hover.d.title}</div>
            <div className="mt-1 text-[11px] text-ink-3">Click to jump to it</div>
          </div>
        )}
      </div>
    </div>
  );
}
