import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EciPoint, LabGroup, MetrPoint, Model } from '../../../shared/types.ts';
import { ActiveFilters, DateFilter, FilterButton, MultiSelectList, SingleSelect, type DatePreset, type Option } from '../../components/filters/Filters.tsx';
import { Chip } from '../../components/ui/Chip.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { useCore, useTrends } from '../../lib/data.ts';
import { addMonths, ANY_DATE, todayIso, type DateFilterValue } from '../../lib/filters.ts';
import { monthYear } from '../../lib/format.ts';
import { LAB_GROUPS, LAB_META, labVar } from '../../lib/labs.ts';
import {
  buildModelIndex,
  compact,
  datePill,
  inDate,
  inScope,
  isSelected,
  listSummary,
  optionRef,
  selectionOf,
  type ModelIndex,
  type ModelMode,
  type ModelRef,
  type Weights,
} from './filterModel.ts';

/** Every lab group the filter row offers, "other" last. */
export const ALL_GROUPS: LabGroup[] = [...LAB_GROUPS, 'other'];

interface ChartFilters {
  labs: ReadonlySet<LabGroup>;
  /** Release-date window (calendar, before / after / between). */
  date: DateFilterValue;
  /** Selected model keys (registry id or `n:<name>`); empty = no model filter. */
  models: string[];
  modelMode: ModelMode;
  weights: Weights;
  labOn: (g: LabGroup) => boolean;
  /** Accepts an ISO date or epoch ms; undated points pass only when no date filter is set. */
  inRange: (d: string | number | undefined | null) => boolean;
  toggleLab: (g: LabGroup) => void;
  soloLab: (g: LabGroup) => void;
  resetLabs: () => void;
  setDate: (d: DateFilterValue) => void;
  setModels: (m: string[]) => void;
  setModelMode: (m: ModelMode) => void;
  setWeights: (w: Weights) => void;
  clearAll: () => void;
}

const Ctx = createContext<ChartFilters | null>(null);

export interface ChartFiltersSeed {
  labs?: LabGroup[];
  date?: DateFilterValue;
  models?: string[];
  modelMode?: ModelMode;
  weights?: Weights;
}

/** Shared lab / release-date / model / open-weights filters that scope every model-based Charts Lab module. `initial` seeds them (deep links, tests). */
export function ChartFiltersProvider({ children, initial }: { children: ReactNode; initial?: ChartFiltersSeed }) {
  const [labs, setLabs] = useState<ReadonlySet<LabGroup>>(() => new Set(initial?.labs?.length ? initial.labs : ALL_GROUPS));
  const [date, setDate] = useState<DateFilterValue>(initial?.date ?? ANY_DATE);
  const [models, setModels] = useState<string[]>(initial?.models ?? []);
  const [modelMode, setModelMode] = useState<ModelMode>(initial?.modelMode ?? 'highlight');
  const [weights, setWeights] = useState<Weights>(initial?.weights ?? 'all');

  const toggleLab = useCallback(
    (g: LabGroup) =>
      setLabs((prev) => {
        const next = new Set(prev);
        if (next.has(g)) next.delete(g);
        else next.add(g);
        // Never allow an empty selection: toggling the last lab off restores all.
        return next.size ? next : new Set(ALL_GROUPS);
      }),
    [],
  );
  const soloLab = useCallback((g: LabGroup) => setLabs(new Set([g])), []);
  const resetLabs = useCallback(() => setLabs(new Set(ALL_GROUPS)), []);
  const clearAll = useCallback(() => {
    setLabs(new Set(ALL_GROUPS));
    setDate(ANY_DATE);
    setModels([]);
    setWeights('all');
  }, []);

  const value = useMemo<ChartFilters>(
    () => ({
      labs,
      date,
      models,
      modelMode,
      weights,
      labOn: (g) => labs.has(g),
      inRange: (d) => inDate(d, date),
      toggleLab,
      soloLab,
      resetLabs,
      setDate,
      setModels,
      setModelMode,
      setWeights,
      clearAll,
    }),
    [labs, date, models, modelMode, weights, toggleLab, soloLab, resetLabs, clearAll],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChartFilters(): ChartFilters {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChartFilters must be used inside <ChartFiltersProvider>');
  return v;
}

// One index per data bundle, shared by every module (the hooks return stable objects).
let indexCache: { models: Model[]; eci: EciPoint[]; metr: MetrPoint[]; idx: ModelIndex } | null = null;
function modelIndexOf(models: Model[], eci: EciPoint[], metr: MetrPoint[]): ModelIndex {
  if (indexCache?.models !== models || indexCache.eci !== eci || indexCache.metr !== metr) indexCache = { models, eci, metr, idx: buildModelIndex(models, eci, metr) };
  return indexCache.idx;
}

type ScopedRef = ModelRef & { g: LabGroup; date?: string | number | null };

export interface ModelScope {
  idx: ModelIndex;
  /** Passes labs + release date + open weights + (in "show only" mode) the model selection. */
  keep: (p: ScopedRef) => boolean;
  /** Is this point one of the picked models? (false when nothing is picked) */
  picked: (p: ModelRef) => boolean;
  /** Models are picked and the mode is "highlight": draw the rest faded. */
  highlight: boolean;
  /** Models are picked (either mode). */
  anyPicked: boolean;
  mode: ModelMode;
}

/** Data-aware view of the global filters; call under <Suspense>. */
export function useModelScope(): ModelScope {
  const core = useCore();
  const trends = useTrends();
  const f = useChartFilters();
  const idx = modelIndexOf(core.models, trends.eci, trends.metr);
  const sel = useMemo(() => selectionOf(f.models, idx), [f.models, idx]);
  return useMemo(() => {
    const state = { labs: f.labs, date: f.date, weights: f.weights, mode: f.modelMode, sel };
    return {
      idx,
      keep: (p: ScopedRef) => inScope(p, state, idx),
      picked: (p: ModelRef) => isSelected(p, sel),
      highlight: f.modelMode === 'highlight' && sel.size > 0,
      anyPicked: sel.size > 0,
      mode: f.modelMode,
    };
  }, [f.labs, f.date, f.weights, f.modelMode, sel, idx]);
}

/** Height of the app's sticky header, so the filter row can dock just beneath it. */
function useHeaderOffset(fallback = 100) {
  const [h, setH] = useState(fallback);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('header.sticky');
    if (!el) return;
    const update = () => setH(Math.round(el.getBoundingClientRect().height));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return h;
}

const WEIGHT_OPTS: { value: Weights; label: string; hint?: string }[] = [
  { value: 'all', label: 'Open + closed' },
  { value: 'open', label: 'Open weights only', hint: 'downloadable' },
  { value: 'closed', label: 'Closed only', hint: 'API / product' },
];

/** Release-window presets, anchored on today. */
function releasePresets(): DatePreset[] {
  const t = todayIso();
  return [
    { label: 'Last 6 months', value: { mode: 'after', from: addMonths(t, -6) } },
    { label: 'Last 12 months', value: { mode: 'after', from: addMonths(t, -12) } },
    { label: 'Since 2025', value: { mode: 'after', from: '2025-01-01' } },
    { label: 'Since 2024', value: { mode: 'after', from: '2024-01-01' } },
    { label: 'Since o1 (Sep 2024)', value: { mode: 'after', from: '2024-09-12' } },
    { label: 'Since 2023', value: { mode: 'after', from: '2023-01-01' } },
    { label: 'Before 2025', value: { mode: 'before', to: '2024-12-31' } },
  ];
}

/** Sticky filter row: lab chips, release window, model picker, open-weights scope, and the active pills. */
export function FilterBar() {
  const f = useChartFilters();
  const scope = useModelScope();
  const trends = useTrends();
  const top = useHeaderOffset();
  const allOn = f.labs.size === ALL_GROUPS.length;
  const { idx } = scope;

  const presets = useMemo(releasePresets, []);
  const marks = useMemo(() => new Set(idx.options.map((o) => o.date).filter((d): d is string => !!d)), [idx]);
  const minYear = useMemo(() => Math.min(2019, ...trends.eci.map((p) => Number(p.date.slice(0, 4)))), [trends.eci]);

  // Model options: everything the lab / date / weights filters let through (whatever the pick mode), plus anything already picked.
  const byKey = useMemo(() => new Map(idx.options.map((o) => [o.key, o])), [idx]);
  const modelOptions = useMemo<Option[]>(() => {
    const state = { labs: f.labs, date: f.date, weights: f.weights, mode: 'highlight' as const, sel: selectionOf([], idx) };
    const picked = new Set(f.models);
    return idx.options
      .filter((o) => picked.has(o.key) || inScope(optionRef(o), state, idx))
      .map((o) => ({ value: o.key, label: o.label, color: labVar(o.g), glyph: LAB_META[o.g].glyph, group: LAB_META[o.g].label, hint: o.date ? monthYear(o.date) : undefined }));
  }, [idx, f.labs, f.date, f.weights, f.models]);

  const inView = useMemo(() => idx.options.filter((o) => scope.keep(optionRef(o))).length, [idx, scope]);
  const nameOf = useCallback((k: string) => byKey.get(k)?.label ?? k.replace(/^n:/, ''), [byKey]);

  const pills = compact([
    !allOn && { key: 'labs', label: `Labs: ${listSummary([...f.labs], (g) => LAB_META[g as LabGroup].label, 3)}`, onClear: f.resetLabs },
    datePill('date', 'Released', f.date, () => f.setDate(ANY_DATE)),
    f.models.length > 0 && { key: 'models', label: `${f.modelMode === 'only' ? 'Only' : 'Highlight'}: ${listSummary(f.models, nameOf)}`, onClear: () => f.setModels([]) },
    f.weights !== 'all' && { key: 'weights', label: WEIGHT_OPTS.find((w) => w.value === f.weights)!.label, onClear: () => f.setWeights('all') },
  ]);

  return (
    <div className="z-20 -mx-1 px-1 py-2 sm:sticky" style={{ top: top + 8 }}>
      <div className="space-y-2 rounded-[18px] border border-line bg-[color-mix(in_oklab,var(--bg)_74%,transparent)] px-3 py-2 shadow-[0_12px_32px_-20px_rgba(0,0,0,.6)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2">
          <span className="kicker mr-1 hidden sm:inline">Labs</span>
          {ALL_GROUPS.map((g) => (
            <Chip key={g} active={f.labOn(g)} onClick={() => f.toggleLab(g)} color={labVar(g)} glyph={LAB_META[g].glyph} title={`Toggle ${LAB_META[g].label}. Double-click to show only this lab.`}>
              <span onDoubleClick={() => f.soloLab(g)}>{LAB_META[g].label}</span>
            </Chip>
          ))}
          {!allOn && (
            <button onClick={f.resetLabs} className="rounded-full px-2 py-1 font-mono text-[10.5px] text-ink-3 underline decoration-line-2 underline-offset-2 hover:text-ink">
              all labs
            </button>
          )}
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <DateFilter label="Released" value={f.date} onChange={f.setDate} marks={marks} presets={presets} minYear={minYear} />
            <FilterButton label="Models" summary={f.models.length ? (f.models.length === 1 ? nameOf(f.models[0]) : `${f.models.length} · ${f.modelMode === 'only' ? 'only' : 'highlight'}`) : undefined} active={f.models.length > 0} width={360} align="end">
              {() => (
                <div>
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11.5px] text-ink-3">Picked models are</span>
                    <Segmented<ModelMode>
                      label="Model filter mode"
                      value={f.modelMode}
                      onChange={f.setModelMode}
                      options={[
                        { value: 'highlight', label: 'Highlighted', title: 'Keep every point; emphasise the picked models' },
                        { value: 'only', label: 'The only ones', title: 'Drop every other model from the charts' },
                      ]}
                    />
                  </div>
                  <MultiSelectList options={modelOptions} value={f.models} onChange={f.setModels} searchable />
                  <p className="mt-2 border-t border-line pt-2 text-[11px] leading-snug text-ink-3">Registry models plus every model Epoch or METR rates. The 3D space always shows only the picked models.</p>
                </div>
              )}
            </FilterButton>
            <SingleSelect<Weights> label="Weights" value={f.weights} onChange={f.setWeights} options={WEIGHT_OPTS} defaultValue="all" width={230} />
          </div>
        </div>
        <ActiveFilters pills={pills} onClearAll={f.clearAll} count={inView} total={idx.options.length} noun="models in view" />
      </div>
    </div>
  );
}
