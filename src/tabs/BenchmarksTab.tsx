import { motion } from 'motion/react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BenchGroup, Effort, Model } from '../../shared/types.ts';
import { BENCH_GROUP_ORDER } from '../../shared/types.ts';
import { GROUP_LABEL } from '../components/ModelDrawer.tsx';
import { ActiveFilters, DateFilter, MultiSelect, RangeFilter, SearchInput, SingleSelect, ToggleFilter, type ActivePill, type Option } from '../components/filters/Filters.tsx';
import { Drawer, Skeleton } from '../components/ui/misc.tsx';
import { useCore, useScores } from '../lib/data.ts';
import { ANY_DATE, countBy, inRange, isDateActive, isRangeActive, matchDate, summarizeDate, textMatch, type DateFilterValue, type RangeValue } from '../lib/filters.ts';
import { monthYear, shortDate } from '../lib/format.ts';
import { LAB_GROUPS, LAB_META, LAB_NAME, labVar } from '../lib/labs.ts';
import { indexScores, type CellFilter } from '../lib/scores.ts';
import { openModel } from '../lib/ui-state.ts';
import { buildColumns, resolveCells } from './bench/columns.ts';
import { Matrix } from './bench/Matrix.tsx';

const BenchSkyline = lazy(() => import('../components/three/BenchSkyline.tsx'));

type View = 'matrix' | 'skyline' | 'vectors' | 'pretrains' | 'method';
type Sort = 'oldest' | 'newest' | 'eci' | 'coverage' | 'name';
const EFFORTS: ('max' | Effort)[] = ['max', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const GROUP_SHORT: Record<BenchGroup, string> = { hle: 'HLE', swe: 'SWE', agentic: 'Agentic', science: 'Science', math: 'Math', bio: 'Bio', index: 'Indices' };

interface F {
  q: string;
  labs: string[];
  models: string[];
  released: DateFilterValue;
  groups: string[];
  benches: string[];
  effort: 'max' | Effort;
  prov: 'any' | 'independent' | 'lab';
  types: string[];
  markers: string[];
  coverage: RangeValue;
  hideEmpty: boolean;
  hideSaturated: boolean;
  sotaOnly: boolean;
  sort: Sort;
  density: 'comfortable' | 'compact';
}
const INITIAL: F = {
  q: '',
  labs: [],
  models: [],
  released: ANY_DATE,
  groups: [],
  benches: [],
  effort: 'max',
  prov: 'any',
  types: [],
  markers: [],
  coverage: {},
  hideEmpty: true,
  hideSaturated: false,
  sotaOnly: false,
  sort: 'oldest',
  density: 'comfortable',
};

/** "tier:variant" style facets: OR within a facet group, AND across groups. */
function matchTypes(m: Model, types: string[]) {
  if (!types.length) return true;
  const byGroup = new Map<string, string[]>();
  for (const t of types) {
    const [g, v] = t.split(':');
    byGroup.set(g, [...(byGroup.get(g) ?? []), v]);
  }
  for (const [g, vs] of byGroup) {
    const val = g === 'tier' ? m.tier : g === 'status' ? m.status : m.openWeights ? 'open' : 'closed';
    if (!vs.includes(val)) return false;
  }
  return true;
}

export default function BenchmarksTab() {
  const core = useCore();
  const { records } = useScores();
  const idx = useMemo(() => indexScores(records), [records]);
  const allCols = useMemo(() => buildColumns(core.benchmarks), [core.benchmarks]);
  const [view, setView] = useState<View>('matrix');
  const [f, setF] = useState<F>(INITIAL);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [mobileFilters, setMobileFilters] = useState(false);
  const set = <K extends keyof F>(k: K, v: F[K]) => setF((p) => ({ ...p, [k]: v }));

  // The table fills exactly the viewport left under the sticky header + filter bar.
  const barRef = useRef<HTMLDivElement>(null);
  const [barH, setBarH] = useState(120);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBarH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fillHeight = `max(460px, calc(100dvh - var(--hdr, 97px) - ${barH}px - 44px))`;

  const vecIds = useMemo(() => new Set(core.scalingVectors.map((v) => v.id)), [core.scalingVectors]);

  // Models passing every model-level filter (markers need cells, applied after).
  const baseModels = useMemo(
    () =>
      core.models.filter(
        (m) =>
          (!f.labs.length || f.labs.includes(m.labGroup)) &&
          (!f.models.length || f.models.includes(m.id)) &&
          matchDate(m.released, f.released) &&
          matchTypes(m, f.types) &&
          textMatch(`${m.name} ${LAB_NAME[m.lab]} ${m.id}`, f.q),
      ),
    [core.models, f.labs, f.models, f.released, f.types, f.q],
  );

  const colsBase = useMemo(
    () => allCols.filter((c) => (!f.groups.length || f.groups.includes(c.group)) && (!f.benches.length || f.benches.includes(c.bench.id)) && (!f.hideSaturated || !c.bench.saturatedOn)),
    [allCols, f.groups, f.benches, f.hideSaturated],
  );
  const global: CellFilter = useMemo(() => ({ effort: f.effort, prov: f.prov }), [f.effort, f.prov]);
  const { cells, colHasData } = useMemo(() => resolveCells(baseModels, colsBase, idx, global), [baseModels, colsBase, idx, global]);
  const cols = useMemo(() => colsBase.filter((c) => !f.hideEmpty || colHasData.get(c.key)), [colsBase, f.hideEmpty, colHasData]);

  const models = useMemo(() => {
    const colKeys = cols.map((c) => c.key);
    return baseModels.filter((m) => {
      const n = colKeys.reduce((acc, k) => acc + (cells.has(`${m.id}|${k}`) ? 1 : 0), 0);
      if (!inRange(n, f.coverage)) return false;
      if (!f.markers.length) return true;
      return (
        (f.markers.includes('pretrain') && m.pretrain === true) ||
        (f.markers.includes('vector') && !!m.scalingVector && vecIds.has(m.scalingVector)) ||
        (f.markers.includes('sota') && colKeys.some((k) => cells.get(`${m.id}|${k}`)?.sota))
      );
    });
  }, [baseModels, cols, cells, f.coverage, f.markers, vecIds]);

  const sorted = useMemo(() => {
    const coverage = (id: string) => cols.reduce((a, c) => a + (cells.has(`${id}|${c.key}`) ? 1 : 0), 0);
    let out = [...models].sort((a, b) => a.released.localeCompare(b.released) || a.name.localeCompare(b.name));
    if (f.sort === 'newest') out.reverse();
    if (f.sort === 'eci') out.sort((a, b) => (b.eci?.value ?? -1) - (a.eci?.value ?? -1));
    if (f.sort === 'coverage') out.sort((a, b) => coverage(b.id) - coverage(a.id));
    if (f.sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
    if (sortKey) {
      const col = allCols.find((c) => c.key === sortKey);
      if (col) {
        const val = (id: string) => cells.get(`${id}|${sortKey}`)?.value;
        out = out.sort((a, b) => {
          const va = val(a.id);
          const vb = val(b.id);
          if (va === undefined) return 1;
          if (vb === undefined) return -1;
          return col.bench.higherIsBetter ? vb - va : va - vb;
        });
      }
    }
    return out;
  }, [models, f.sort, sortKey, cells, cols, allCols]);

  const filled = useMemo(() => {
    let n = 0;
    for (const m of sorted) for (const c of cols) if (cells.has(`${m.id}|${c.key}`)) n++;
    return n;
  }, [sorted, cols, cells]);

  // ── Options with facet counts ─────────────────────────────────────────────
  const labCounts = countBy(core.models, (m) => m.labGroup);
  const labOptions: Option[] = LAB_GROUPS.map((g) => ({ value: g, label: LAB_META[g].label, color: labVar(g), glyph: LAB_META[g].glyph, count: labCounts.get(g) ?? 0 }));
  const modelOptions: Option[] = [...core.models]
    .sort((a, b) => LAB_GROUPS.indexOf(a.labGroup) - LAB_GROUPS.indexOf(b.labGroup) || a.released.localeCompare(b.released))
    .map((m) => ({ value: m.id, label: m.name, color: labVar(m.labGroup), glyph: LAB_META[m.labGroup].glyph, group: LAB_META[m.labGroup].label, hint: m.released.slice(0, 7) }));
  const groupCounts = countBy(allCols, (c) => c.group);
  const groupOptions: Option[] = BENCH_GROUP_ORDER.map((g) => ({ value: g, label: GROUP_LABEL[g], count: groupCounts.get(g) ?? 0 }));
  const benchFilled = countBy(records, (r) => r.b);
  const benchOptions: Option[] = BENCH_GROUP_ORDER.flatMap((g) =>
    core.benchmarks.filter((b) => b.group === g).map((b) => ({ value: b.id, label: b.name, group: GROUP_LABEL[g], count: benchFilled.get(b.id) ?? 0, hint: b.saturatedOn ? 'sat.' : undefined })),
  );
  const typeCount = (fn: (m: Model) => boolean) => core.models.filter(fn).length;
  const typeOptions: Option[] = [
    { value: 'tier:flagship', label: 'Flagship', group: 'Tier', count: typeCount((m) => m.tier === 'flagship') },
    { value: 'tier:variant', label: 'Variant (Pro, Heavy, mini…)', group: 'Tier', count: typeCount((m) => m.tier === 'variant') },
    { value: 'status:released', label: 'Released', group: 'Availability', count: typeCount((m) => m.status === 'released') },
    { value: 'status:restricted', label: 'Restricted access', group: 'Availability', count: typeCount((m) => m.status === 'restricted') },
    { value: 'status:announced', label: 'Announced, unreleased', group: 'Availability', count: typeCount((m) => m.status === 'announced') },
    { value: 'weights:open', label: 'Open weights', group: 'Weights', count: typeCount((m) => !!m.openWeights) },
    { value: 'weights:closed', label: 'Closed weights', group: 'Weights', count: typeCount((m) => !m.openWeights) },
  ];
  const markerOptions: Option[] = [
    { value: 'pretrain', label: '◆ New pre-train', count: typeCount((m) => m.pretrain === true) },
    { value: 'vector', label: '⚡ Introduced a scaling vector', count: typeCount((m) => !!m.scalingVector) },
    { value: 'sota', label: '★ Set a state of the art (in view)' },
  ];
  const releaseMarks = useMemo(() => new Set(core.models.map((m) => m.released)), [core.models]);
  const coverageMax = Math.max(1, cols.length);

  // ── Active pills ─────────────────────────────────────────────────────────
  const pills: ActivePill[] = [];
  const nameOf = (list: Option[], v: string) => list.find((o) => o.value === v)?.label ?? v;
  if (f.q) pills.push({ key: 'q', label: `“${f.q}”`, onClear: () => set('q', '') });
  for (const v of f.labs) pills.push({ key: `lab${v}`, label: nameOf(labOptions, v), onClear: () => set('labs', f.labs.filter((x) => x !== v)) });
  if (f.models.length) pills.push({ key: 'models', label: f.models.length === 1 ? nameOf(modelOptions, f.models[0]) : `${f.models.length} models`, onClear: () => set('models', []) });
  if (isDateActive(f.released)) pills.push({ key: 'rel', label: `Released: ${summarizeDate(f.released)}`, onClear: () => set('released', ANY_DATE) });
  for (const v of f.groups) pills.push({ key: `g${v}`, label: GROUP_SHORT[v as BenchGroup], onClear: () => set('groups', f.groups.filter((x) => x !== v)) });
  if (f.benches.length) pills.push({ key: 'b', label: f.benches.length === 1 ? nameOf(benchOptions, f.benches[0]) : `${f.benches.length} benchmarks`, onClear: () => set('benches', []) });
  if (f.effort !== 'max') pills.push({ key: 'eff', label: `Effort: ${f.effort}`, onClear: () => set('effort', 'max') });
  if (f.prov !== 'any') pills.push({ key: 'prov', label: f.prov === 'independent' ? '● Independent only' : '○ Lab-reported only', onClear: () => set('prov', 'any') });
  for (const v of f.types) pills.push({ key: `t${v}`, label: nameOf(typeOptions, v), onClear: () => set('types', f.types.filter((x) => x !== v)) });
  for (const v of f.markers) pills.push({ key: `m${v}`, label: nameOf(markerOptions, v), onClear: () => set('markers', f.markers.filter((x) => x !== v)) });
  if (isRangeActive(f.coverage)) pills.push({ key: 'cov', label: `Results/model ${f.coverage.min ?? 0}–${f.coverage.max ?? coverageMax}`, onClear: () => set('coverage', {}) });
  if (!f.hideEmpty) pills.push({ key: 'empty', label: 'Showing empty columns', onClear: () => set('hideEmpty', true) });
  if (f.hideSaturated) pills.push({ key: 'sat', label: 'Hiding saturated', onClear: () => set('hideSaturated', false) });
  if (f.sotaOnly) pills.push({ key: 'sota', label: '★ SOTA cells only', onClear: () => set('sotaOnly', false) });
  if (sortKey) pills.push({ key: 'sortcol', label: `Sorted by ${allCols.find((c) => c.key === sortKey)?.label}`, onClear: () => setSortKey(null) });
  const clearAll = () => {
    setF((p) => ({ ...INITIAL, density: p.density, sort: p.sort }));
    setSortKey(null);
  };

  const indep = records.filter((r) => r.prov === 'independent').length;

  const controls = (
    <>
              <MultiSelect label="Labs" options={labOptions} value={f.labs} onChange={(v) => set('labs', v)} />
              <MultiSelect label="Models" options={modelOptions} value={f.models} onChange={(v) => set('models', v)} width={340} />
              <DateFilter label="Released" value={f.released} onChange={(v) => set('released', v)} marks={releaseMarks} minYear={2023} />
              <MultiSelect label="Model type" options={typeOptions} value={f.types} onChange={(v) => set('types', v)} width={300} />
              <MultiSelect label="Markers" options={markerOptions} value={f.markers} onChange={(v) => set('markers', v)} width={300} />
              <span className="mx-0.5 hidden h-5 w-px bg-line sm:block" />
              <MultiSelect label="Groups" options={groupOptions} value={f.groups} onChange={(v) => set('groups', v)} />
              <MultiSelect label="Benchmarks" options={benchOptions} value={f.benches} onChange={(v) => set('benches', v)} width={380} />
              <SingleSelect label="Effort" value={f.effort} defaultValue="max" onChange={(v) => set('effort', v)} options={EFFORTS.map((e) => ({ value: e, label: e === 'max' ? 'Best of any effort' : e, hint: e === 'max' ? 'default' : undefined }))} />
              <SingleSelect
                label="Source"
                value={f.prov}
                defaultValue="any"
                onChange={(v) => set('prov', v)}
                options={[
                  { value: 'any', label: 'Any source' },
                  { value: 'independent', label: '● Independent only', hint: 'Epoch, leaderboards' },
                  { value: 'lab', label: '○ Lab-reported only', hint: 'model cards' },
                ]}
              />
              <RangeFilter label="Results/model" domain={[0, coverageMax]} value={f.coverage} onChange={(v) => set('coverage', v)} />
              <ToggleFilter label="★ SOTA only" value={f.sotaOnly} onChange={(v) => set('sotaOnly', v)} title="Fade every cell that wasn't a new state of the art when released" />
              <ToggleFilter label="Hide saturated" value={f.hideSaturated} onChange={(v) => set('hideSaturated', v)} />
              <ToggleFilter label="Hide empty cols" value={f.hideEmpty} onChange={(v) => set('hideEmpty', v)} />
              <SingleSelect
                label="Sort"
                value={f.sort}
                onChange={(v) => (set('sort', v), setSortKey(null))}
                options={[
                  { value: 'oldest', label: 'Release date, oldest first' },
                  { value: 'newest', label: 'Release date, newest first' },
                  { value: 'eci', label: 'Epoch Capabilities Index' },
                  { value: 'coverage', label: 'Most results' },
                  { value: 'name', label: 'Name A–Z' },
                ]}
              />
              <SingleSelect label="Rows" value={f.density} onChange={(v) => set('density', v)} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
    </>
  );

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="grid grid-cols-1 items-end gap-6 pt-2 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div className="kicker mb-3">Benchmarks · GPT-4 (Mar 2023) → today</div>
          <h1 className="text-[32px] font-semibold leading-[1.05] tracking-tight sm:text-[42px]">
            Every frontier model. <span className="text-aurora">Every benchmark that matters.</span>
          </h1>
          <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-ink-2">
            Independent runs (Epoch AI and third-party leaderboards) next to lab-reported numbers from model cards, each with its source. Blank means nobody published a number, and versions are never merged.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4 lg:col-span-5">
          <HeroStat label="Models" value={core.models.length} sub={`${core.models.filter((m) => m.pretrain).length} new pre-trains ◆`} />
          <HeroStat label="Benchmarks" value={core.benchmarks.length} sub={`${allCols.length} columns`} />
          <HeroStat label="Results" value={records.length.toLocaleString()} sub={`${Math.round((indep / records.length) * 100)}% independent`} />
        </div>
      </section>

      {/* Sub-tabs */}
      <nav aria-label="Benchmark views" className="flex gap-1 overflow-x-auto border-b border-line">
        {(
          [
            ['matrix', 'Matrix', `${sorted.length}×${cols.length}`],
            ['skyline', '3D skyline', ''],
            ['vectors', 'Scaling vectors', String(core.scalingVectors.length)],
            ['pretrains', 'New pre-trains', String(core.models.filter((m) => m.pretrain).length)],
            ['method', 'How to read', ''],
          ] as [View, string, string][]
        ).map(([id, label, badge]) => (
          <button key={id} onClick={() => setView(id)} className={`relative -mb-px shrink-0 px-3.5 py-2.5 text-[13px] font-medium transition-colors ${view === id ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}>
            {label}
            {badge && <span className="ml-1.5 font-mono text-[10.5px] text-ink-3">{badge}</span>}
            {view === id && <motion.span layoutId="bench-subtab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </nav>

      {/* Filter bar: sticky under the header; only the table views (matrix, skyline) use it.
          Kept mounted (just hidden) on the reading views so its height observer survives. */}
      <div ref={barRef} className={`full-bleed sticky z-20 border-b ${view === 'matrix' || view === 'skyline' ? '' : 'hidden'} border-line bg-[color-mix(in_oklab,var(--bg)_82%,transparent)] px-4 py-2.5 backdrop-blur-xl sm:px-6`} style={{ top: 'var(--hdr, 97px)' }}>
        <div className="mx-auto flex max-w-[1920px] flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={f.q} onChange={(v) => set('q', v)} placeholder="Search models…" className="min-w-0 flex-1 sm:w-52 sm:flex-none" />
            <button
              type="button"
              onClick={() => setMobileFilters(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface-2/60 px-3 text-[12px] text-ink md:hidden"
            >
              Filters{pills.length ? <span className="rounded-full bg-accent px-1.5 font-mono text-[10.5px] text-accent-ink">{pills.length}</span> : null}
            </button>
            <div className="hidden flex-wrap items-center gap-2 md:contents">{controls}</div>
          </div>
          <ActiveFilters pills={pills} onClearAll={clearAll} count={sorted.length} total={core.models.length} noun={`models · ${cols.length} columns · ${filled.toLocaleString()} filled cells`} />
        </div>
      </div>

      <Drawer open={mobileFilters} onClose={() => setMobileFilters(false)} kicker="Benchmarks" title="Filters">
        <div className="flex flex-wrap gap-2">{controls}</div>
        <div className="mt-4">
          <ActiveFilters pills={pills} onClearAll={clearAll} count={sorted.length} total={core.models.length} noun="models" />
        </div>
      </Drawer>

      {view === 'matrix' && (
        <div className="full-bleed -mt-5 px-2 sm:px-4">
          {sorted.length && cols.length ? (
            <Matrix
              models={sorted}
              cols={cols}
              cells={cells}
              idx={idx}
              vectors={core.scalingVectors}
              sortKey={sortKey}
              onSort={(k) => setSortKey(k === sortKey ? null : k)}
              stickyTop={`calc(var(--hdr, 97px) + ${barH}px)`}
              density={f.density}
              sotaOnly={f.sotaOnly}
            />
          ) : (
            <Empty onClear={clearAll} />
          )}
          <Legend />
        </div>
      )}

      {view === 'skyline' && (
        <div className="full-bleed px-2 sm:px-4">
          <div className="overflow-hidden rounded-xl border border-line" style={{ height: fillHeight }}>
            <Suspense fallback={<Skeleton h={600} />}>
              {sorted.length && cols.length ? <BenchSkyline models={[...sorted].sort((a, b) => a.released.localeCompare(b.released))} cols={cols} cells={cells} /> : <Empty onClear={clearAll} />}
            </Suspense>
          </div>
          <p className="mt-2 text-[12px] text-ink-3">One bar per filled cell: x = models by release date, depth = benchmark columns, height = score relative to its column. Brighter bars were state of the art at release. Drag to orbit, scroll to zoom, click a bar to open the model.</p>
        </div>
      )}

      {view === 'vectors' && <ScalingVectors models={core.models} />}
      {view === 'pretrains' && <Pretrains models={core.models} />}
      {view === 'method' && <Method />}
    </div>
  );
}

function HeroStat({ label, value, sub }: { label: string; value: ReactNode; sub: string }) {
  return (
    <div className="min-w-0">
      <div className="kicker mb-1.5">{label}</div>
      <div className="text-[26px] font-semibold leading-none tracking-tight">{value}</div>
      <div className="mt-1.5 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-ink-3">{sub}</div>
    </div>
  );
}

function Empty({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line-2 text-[13px] text-ink-3">
      Nothing matches these filters.
      <button onClick={onClear} className="rounded-full bg-accent px-3 py-1 text-[12px] font-medium text-accent-ink">
        Clear filters
      </button>
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 text-[11.5px] text-ink-3">
      <span><span className="text-ink">◆</span> new pre-train</span>
      <span><span className="text-accent">⚡</span> new scaling vector</span>
      <span><span className="text-accent">★</span> state of the art at release</span>
      <span>○ lab-reported (else independent)</span>
      <span>t with tools</span>
      <span>sat. saturated (later rows dimmed)</span>
      <span className="inline-flex items-center gap-1.5">
        shading
        <span className="inline-block h-2.5 w-16 rounded-full" style={{ background: 'linear-gradient(90deg, color-mix(in oklab, var(--glow-a) 5%, transparent), color-mix(in oklab, var(--glow-a) 55%, transparent))' }} />
        relative within column
      </span>
      <span>click a header to sort · hover a cell for every source · click a model for its card</span>
    </div>
  );
}

function ScalingVectors({ models }: { models: Model[] }) {
  const core = useCore();
  const byId = new Map(core.models.map((m) => [m.id, m]));
  const visible = new Set(models.map((m) => m.id));
  const vecs = [...core.scalingVectors].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section className="mx-auto max-w-4xl">
      <p className="mb-6 text-[14px] text-ink-2">New ways to turn compute into capability, each tied to the model that introduced it. Every scaling vector on record, with the release that introduced it.</p>
      <ol className="relative space-y-6 border-l border-line pl-6">
        {vecs.map((v) => {
          const m = byId.get(v.introducedBy);
          return (
            <li key={v.id} className={`relative transition-opacity ${m && !visible.has(m.id) ? 'opacity-35' : ''}`}>
              <span className="absolute -left-[33px] top-0 flex h-5 w-5 items-center justify-center rounded-full border border-line-2 bg-surface text-[11px] text-accent">⚡</span>
              <div className="font-mono text-[11px] text-ink-3">
                {shortDate(v.date)} ·{' '}
                {m ? (
                  <button className="underline decoration-line-2 underline-offset-2 hover:text-ink" onClick={() => openModel(m.id)}>
                    {m.name}
                  </button>
                ) : (
                  v.introducedBy
                )}
              </div>
              <div className="mt-0.5 text-[16px] font-semibold tracking-tight">{v.name}</div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{v.summary}</p>
              {v.url && (
                <a href={v.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] text-ink-3 underline decoration-line-2 underline-offset-2 hover:text-ink">
                  source ↗
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Pretrains({ models }: { models: Model[] }) {
  const list = models.filter((m) => m.pretrain).sort((a, b) => a.released.localeCompare(b.released));
  const unknown = models.filter((m) => m.pretrain === null || m.pretrain === undefined).length;
  return (
    <section>
      <p className="mb-5 max-w-3xl text-[14px] text-ink-2">
        Releases built on a freshly pre-trained base model, as opposed to post-training on an existing one. {unknown} of {models.length} tracked models have undisclosed pre-train status.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((m) => (
          <button key={m.id} onClick={() => openModel(m.id)} className="group rounded-xl border border-line bg-surface/50 p-4 text-left transition-colors hover:border-line-2 hover:bg-surface-2/60">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[14px] font-semibold">
                <span className="text-[11px]" style={{ color: labVar(m.labGroup) }}>
                  {LAB_META[m.labGroup].glyph}
                </span>
                {m.name}
              </span>
              <span className="font-mono text-[11px] text-ink-3">{monthYear(m.released)}</span>
            </div>
            {m.pretrainNote && <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{m.pretrainNote}</p>}
            <div className="mt-2 font-mono text-[11px] text-ink-3">
              {m.trainingFlop ? `${m.trainingFlop.toExponential(1)} FLOP` : 'compute undisclosed'}
              {m.params ? ` · ${m.params}` : ''}
            </div>
          </button>
        ))}
        {!list.length && <p className="text-[13px] text-ink-3">No new pre-trains among the models in view.</p>}
      </div>
    </section>
  );
}

function Method() {
  const items: [string, string][] = [
    ['What a cell shows', 'The best result for that model and benchmark under the active filters. By default that is the highest score across effort levels; on a tie, independent runs win over lab-reported numbers. Hover to see every source behind a cell.'],
    ['Independent vs lab-reported', '● Independent = Epoch AI runs and third-party leaderboards (tbench.ai, Scale, ARC Prize, METR…). ○ Lab-reported = the model’s own lab (launch posts, model/system cards). Filter with Source.'],
    ['HLE columns', 'Humanity’s Last Exam is split three ways, because numbers differ wildly by setup: independent (no tools), lab-reported without tools, lab-reported with tools (search / code).'],
    ['Versions', 'Benchmark versions are never merged. SWE-bench Verified ≠ Pro, and Terminal-Bench 1.0 / 2.0 / 2.1 / 3.0 / 4.0 are separate columns. “sat.” marks benchmarks that have effectively maxed out; later rows are dimmed.'],
    ['★ State of the art', 'The model beat every model released before it on that column, using the cells in view. Filtering changes the comparison set.'],
    ['Shading', 'Relative within each column (log scale for hours and dollars), so colour means rank inside a benchmark, not an absolute score.'],
    ['◆ and ⚡', '◆ = new pre-trained base model. ⚡ = the release that introduced a new scaling vector (e.g. o1’s RL test-time reasoning). See the other sub-tabs for the evidence.'],
    ['Blanks', 'Blank = no published number. Nothing is imputed or estimated.'],
  ];
  return (
    <section className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <div className="text-[15px] font-semibold tracking-tight">{k}</div>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{v}</p>
        </div>
      ))}
    </section>
  );
}
