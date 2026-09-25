import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import type { AsiStatus } from '../../../shared/types.ts';
import { ActiveFilters, MultiSelect, SearchInput, type ActivePill, type Option } from '../../components/filters/Filters.tsx';
import { useAlan } from '../../lib/data.ts';
import { countBy, matchAny, textMatch } from '../../lib/filters.ts';
import { PHASE_LABEL } from './feedModel.ts';
import { Highlight, STATUS_META } from './ui.tsx';

interface GridFilters {
  q: string;
  phases: string[];
  statuses: string[];
  types: string[];
}
const EMPTY: GridFilters = { q: '', phases: [], statuses: [], types: [] };
type Key = 'phases' | 'statuses' | 'types';
const STATUS_ORDER: AsiStatus[] = ['achieved', 'partial', 'none'];

/** The ASI checklist as a filterable grid (phase, status as of the replay date, type, search). */
export function AsiGrid({ statuses, selected, onSelect }: { statuses: Map<number, AsiStatus>; selected: number | null; onSelect: (id: number) => void }) {
  const { asi } = useAlan();
  const [f, setF] = useState<GridFilters>(EMPTY);
  const rows = useMemo(
    () => asi.items.map((i) => ({ i, status: statuses.get(i.id) ?? i.status, hay: `#${i.id} ${i.label} ${i.keyword ?? ''} ${i.type} ${i.notes ?? ''}`.toLowerCase() })),
    [asi.items, statuses],
  );
  type Row = (typeof rows)[number];
  const match = (r: Row, skip?: Key) =>
    (skip === 'phases' || matchAny(String(r.i.phase), f.phases)) && (skip === 'statuses' || matchAny(r.status, f.statuses)) && (skip === 'types' || matchAny(r.i.type, f.types)) && textMatch(r.hay, f.q);
  const shown = rows.filter((r) => match(r));
  const facet = (k: Key, key: (r: Row) => string) => countBy(rows.filter((r) => match(r, k)), key);
  const phaseCounts = facet('phases', (r) => String(r.i.phase));
  const statusCounts = facet('statuses', (r) => r.status);
  const typeCounts = facet('types', (r) => r.i.type);

  const phaseOpts: Option[] = [1, 2, 3].map((p) => ({ value: String(p), label: `${p} · ${PHASE_LABEL[p]}`, count: phaseCounts.get(String(p)) ?? 0 }));
  const statusOpts: Option[] = STATUS_ORDER.map((s) => ({ value: s, label: STATUS_META[s].label, count: statusCounts.get(s) ?? 0, color: STATUS_META[s].color, glyph: STATUS_META[s].icon }));
  const typeOpts: Option[] = [...new Set(asi.items.map((i) => i.type).filter(Boolean))].sort().map((t) => ({ value: t, label: t, count: typeCounts.get(t) ?? 0 }));

  const set = (p: Partial<GridFilters>) => setF((prev) => ({ ...prev, ...p }));
  const drop = (k: Key, v: string) => setF((prev) => ({ ...prev, [k]: prev[k].filter((x) => x !== v) }));
  const pills: ActivePill[] = [
    ...(f.q.trim() ? [{ key: 'q', label: `“${f.q.trim()}”`, onClear: () => set({ q: '' }) }] : []),
    ...f.phases.map((v) => ({ key: `p${v}`, label: `Phase ${v}`, onClear: () => drop('phases', v) })),
    ...f.statuses.map((v) => ({ key: `s${v}`, label: STATUS_META[v as AsiStatus]?.label ?? v, onClear: () => drop('statuses', v) })),
    ...f.types.map((v) => ({ key: `t${v}`, label: v, onClear: () => drop('types', v) })),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={f.q} onChange={(q) => set({ q })} placeholder="Search indicators…" className="w-full sm:w-56" />
        <MultiSelect label="Phase" options={phaseOpts} value={f.phases} onChange={(v) => set({ phases: v })} />
        <MultiSelect label="Status" options={statusOpts} value={f.statuses} onChange={(v) => set({ statuses: v })} />
        <MultiSelect label="Type" options={typeOpts} value={f.types} onChange={(v) => set({ types: v })} />
      </div>
      <div className="mt-3 min-h-[24px]">
        <ActiveFilters pills={pills} onClearAll={() => setF(EMPTY)} count={shown.length} total={rows.length} noun="indicators" />
      </div>

      <div className="mt-3 space-y-4">
        {([1, 2, 3] as const).map((p) => {
          const its = shown.filter((r) => r.i.phase === p);
          if (!its.length) return null;
          return (
            <div key={p}>
              <div className="kicker mb-2">
                Phase {p} · {PHASE_LABEL[p]}
              </div>
              <motion.div layout className="relative grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                <AnimatePresence initial={false} mode="popLayout">
                  {its.map(({ i, status }) => (
                    <motion.button
                      layout
                      key={i.id}
                      type="button"
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ duration: 0.18 }}
                      onClick={() => onSelect(i.id)}
                      aria-pressed={selected === i.id}
                      className={`rounded-xl border p-2.5 text-left text-[12px] transition-colors ${selected === i.id ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-line bg-surface-2/50 hover:border-line-2'}`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-mono text-[10.5px] text-ink-3">
                          #{i.id} · {i.type}
                        </span>
                        <span style={{ color: STATUS_META[status].color }} title={STATUS_META[status].label}>
                          {STATUS_META[status].icon}
                          <span className="sr-only">{STATUS_META[status].label}</span>
                        </span>
                      </div>
                      <div className="line-clamp-2 leading-snug text-ink">
                        <Highlight text={i.label} q={f.q} />
                      </div>
                    </motion.button>
                  ))}
                </AnimatePresence>
              </motion.div>
            </div>
          );
        })}
        {!shown.length && (
          <div className="rounded-xl border border-dashed border-line-2 px-4 py-10 text-center text-[12.5px] text-ink-3">
            No indicators match.{' '}
            <button type="button" onClick={() => setF(EMPTY)} className="font-medium text-ink underline decoration-line-2 underline-offset-2">
              Clear filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
