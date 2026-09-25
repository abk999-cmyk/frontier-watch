import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Model, ScalingVector } from '../../../shared/types.ts';
import { fmtBench, monthYear, shortDate } from '../../lib/format.ts';
import { LAB_META, labVar } from '../../lib/labs.ts';
import type { ScoreIndex } from '../../lib/scores.ts';
import { openModel } from '../../lib/ui-state.ts';
import type { CellInfo, Column } from './columns.ts';
import { GROUP_LABEL } from '../../components/ModelDrawer.tsx';

// ── Hover store: the tooltip re-renders on hover, the 5k cells never do. ──
type Hover = { m: string; c: string; x: number; y: number } | null;
let hover: Hover = null;
const subs = new Set<() => void>();
const setHover = (h: Hover) => {
  hover = h;
  subs.forEach((f) => f());
};
const useHover = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => hover);

interface Props {
  models: Model[];
  cols: Column[];
  cells: Map<string, CellInfo>;
  idx: ScoreIndex;
  vectors: ScalingVector[];
  sortKey: string | null;
  onSort: (key: string) => void;
  /** CSS `top` for the pinned column header (page scrolls; header sticks below the site header + filters). */
  stickyTop?: string;
  density?: 'comfortable' | 'compact';
  /** Fade every cell that wasn't a new state of the art at release. */
  sotaOnly?: boolean;
}

const FIRST_W = 236;
const COL_W = 74;

export const Matrix = memo(function Matrix({ models, cols, cells, idx, vectors, sortKey, onSort, stickyTop = '0px', density = 'comfortable', sotaOnly = false }: Props) {
  const rowH = density === 'compact' ? 'h-[30px]' : 'h-[38px]';
  const styleRef = useRef<HTMLStyleElement>(null);
  // The table lives in the page flow (the page scrolls vertically). Only horizontal overflow is
  // handled here: the body scrolls sideways, and the pinned header plus a pinned bottom scrollbar
  // mirror its scrollLeft.
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const totalW = FIRST_W + cols.length * COL_W;
  const syncFrom = (src: HTMLDivElement | null) => {
    if (!src || syncing.current) return;
    syncing.current = true;
    for (const el of [headRef.current, bodyRef.current, barRef.current]) if (el && el !== src) el.scrollLeft = src.scrollLeft;
    requestAnimationFrame(() => (syncing.current = false));
  };
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setOverflowing(el.scrollWidth > el.clientWidth + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [totalW]);
  const colgroup = (
    <colgroup>
      <col style={{ width: FIRST_W }} />
      {cols.map((c) => (
        <col key={c.key} style={{ width: COL_W }} />
      ))}
    </colgroup>
  );
  const colIndex = new Map(cols.map((c, i) => [c.key, i]));
  const vecById = new Map(vectors.map((v) => [v.id, v]));

  // Group header spans.
  const groups: { g: Column['group']; span: number }[] = [];
  for (const c of cols) {
    const last = groups.at(-1);
    if (last && last.g === c.group) last.span++;
    else groups.push({ g: c.group, span: 1 });
  }
  const groupStart = new Set<number>();
  let acc = 0;
  for (const g of groups) {
    groupStart.add(acc);
    acc += g.span;
  }

  // Crosshair via a single <style> rule (no React re-render on hover).
  const onOver = (e: React.MouseEvent) => {
    const td = (e.target as HTMLElement).closest('[data-c]') as HTMLElement | null;
    if (!td) return;
    const r = td.dataset.r!;
    const c = td.dataset.c!;
    if (styleRef.current)
      styleRef.current.textContent = `.mx [data-r="${r}"]:not(.mx-sticky){background-color:color-mix(in oklab,var(--text) 4%,transparent)}.mx [data-c="${c}"]{box-shadow:inset 1px 0 0 var(--line-2),inset -1px 0 0 var(--line-2)}.mx th[data-c="${c}"]{color:var(--text)}.mx td[data-r="${r}"][data-c="${c}"]{outline:1.5px solid var(--accent);outline-offset:-1.5px}`;
    const rect = td.getBoundingClientRect();
    const key = cols[Number(c)]?.key;
    if (key && td.dataset.m && cells.has(`${td.dataset.m}|${key}`)) setHover({ m: td.dataset.m, c: key, x: rect.left + rect.width / 2, y: rect.top });
    else setHover(null);
  };
  const onLeave = () => {
    if (styleRef.current) styleRef.current.textContent = '';
    setHover(null);
  };

  // Year dividers.
  let lastYear = '';

  return (
    <div className="relative">
      <style ref={styleRef} />
      <div className="mx isolate" onMouseOver={onOver} onMouseLeave={onLeave}>
        {/* Pinned column header: sticks under the site header + filter bar while the page scrolls. */}
        <div
          ref={headRef}
          className="no-scrollbar sticky z-20 overflow-hidden border-b border-line-2 bg-[color-mix(in_oklab,var(--bg)_88%,transparent)] backdrop-blur-xl"
          style={{ top: stickyTop }}
          onWheel={(e) => {
            const b = bodyRef.current;
            if (b && (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey)) b.scrollLeft += e.deltaX || e.deltaY;
          }}
        >
          <table className="border-separate border-spacing-0 text-[12px]" style={{ width: totalW, tableLayout: 'fixed' }}>
            {colgroup}
            <thead>
              <tr>
                <th className="mx-sticky sticky left-0 z-30 bg-[var(--bg)] px-3 py-2 text-left align-bottom" rowSpan={2}>
                  <span className="kicker">Model · released</span>
                </th>
                {groups.map((g, i) => (
                  <th key={i} colSpan={g.span} className="h-8 border-l border-line px-2 text-left align-middle">
                    <span className="kicker sticky left-[244px] inline-block whitespace-nowrap !text-ink-2">{GROUP_LABEL[g.g]}</span>
                  </th>
                ))}
              </tr>
              <tr>
                {cols.map((c, i) => {
                  const sat = c.bench.saturatedOn;
                  return (
                    <th
                      key={c.key}
                      data-c={i}
                      onClick={() => onSort(c.key)}
                      title={`${c.bench.name}${c.sub ? ` (${c.sub})` : ''}\n${c.bench.description ?? ''}${sat ? `\nSaturated ~${monthYear(sat)}` : ''}\nClick to sort`}
                      className={`h-[58px] cursor-pointer select-none px-1.5 pb-1.5 text-left align-bottom font-medium text-ink-2 transition-colors hover:text-ink ${groupStart.has(i) ? 'border-l border-line' : ''}`}
                    >
                      <div className="line-clamp-2 text-[11.5px] leading-tight">{c.label}</div>
                      {c.sub && <div className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[9.5px] text-ink-3">{c.sub}</div>}
                      <div className="flex gap-1 font-mono text-[9px] text-ink-3">
                        {sat && <span title={`Saturated ~${monthYear(sat)}`}>sat.</span>}
                        {sortKey === c.key && <span className="text-accent">▼</span>}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
          </table>
        </div>

        {/* Body: part of the page. Vertical scrolling is the page's; horizontal is synced. */}
        <div ref={bodyRef} className="no-scrollbar overflow-x-auto overflow-y-hidden" onScroll={(e) => syncFrom(e.currentTarget)}>
        <table className="border-separate border-spacing-0 text-[12px]" style={{ width: totalW, tableLayout: 'fixed' }}>
          {colgroup}
          <tbody>
            {models.map((m, r) => {
              const y = m.released.slice(0, 4);
              const divider = y !== lastYear && !sortKey;
              lastYear = y;
              const vec = m.scalingVector ? vecById.get(m.scalingVector) : undefined;
              return [
                divider && (
                  <tr key={`y${y}`}>
                    <td colSpan={cols.length + 1} className="mx-sticky border-b border-line bg-[color-mix(in_oklab,var(--surface-2)_70%,transparent)] px-3 py-1 font-mono text-[10.5px] tracking-[0.2em] text-ink-3"><span className="sticky left-3">
                      {y}</span>
                    </td>
                  </tr>
                ),
                <tr key={m.id} className={m.status === 'announced' ? 'opacity-45' : ''}>
                  <th
                    scope="row"
                    data-r={r}
                    className="mx-sticky sticky left-0 z-10 border-b border-line bg-[var(--bg)] px-0 text-left font-normal"
                    style={{ boxShadow: `inset 3px 0 0 ${labVar(m.labGroup)}` }}
                  >
                    <button onClick={() => openModel(m.id)} className={`flex w-full items-center gap-2 px-3 text-left hover:bg-surface-2 ${density === 'compact' ? 'py-0.5' : 'py-1.5'}`}>
                      <span className="text-[10px]" style={{ color: labVar(m.labGroup) }} aria-hidden>
                        {LAB_META[m.labGroup].glyph}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[12.5px] ${m.tier === 'variant' ? 'text-ink-2' : 'font-medium text-ink'}`}>
                          {m.tier === 'variant' && <span className="text-ink-3">↳ </span>}
                          {m.name}
                        </span>
                        <span className={`font-mono text-[10px] text-ink-3 ${density === 'compact' ? 'hidden' : 'block'}`}>
                          {shortDate(m.released)}
                          {m.status !== 'released' && <span className="ml-1.5 rounded border border-line px-1">{m.status}</span>}
                        </span>
                      </span>
                      {m.pretrain && (
                        <span title={`New pre-train${m.pretrainNote ? `: ${m.pretrainNote}` : ''}`} className="text-[12px] text-ink">
                          ◆
                        </span>
                      )}
                      {vec && (
                        <span title={`New scaling vector: ${vec.name}. ${vec.summary}`} className="text-[12px] text-accent">
                          ⚡
                        </span>
                      )}
                    </button>
                  </th>
                  {cols.map((c, ci) => {
                    const cell = cells.get(`${m.id}|${c.key}`);
                    const afterSat = c.bench.saturatedOn && m.released > c.bench.saturatedOn;
                    return (
                      <td
                        key={c.key}
                        data-r={r}
                        data-c={ci}
                        data-m={m.id}
                        className={`relative ${rowH} border-b border-line px-1.5 text-right font-mono tnum ${groupStart.has(ci) ? 'border-l' : ''} ${afterSat ? 'opacity-60' : ''} ${sotaOnly && cell && !cell.sota ? 'opacity-20' : ''}`}
                        style={cell ? { backgroundImage: `linear-gradient(color-mix(in oklab, var(--glow-a) ${Math.round(5 + cell.shade * 50)}%, transparent), color-mix(in oklab, var(--glow-a) ${Math.round(5 + cell.shade * 50)}%, transparent))` } : undefined}
                      >
                        {cell ? (
                          <>
                            <span className={`text-[12px] ${cell.shade > 0.85 ? 'font-semibold text-ink' : 'text-ink'}`}>{fmtBench(cell.value, c.bench, true)}</span>
                            <span className="pointer-events-none absolute left-1 top-0.5 flex gap-0.5 text-[8.5px] leading-none text-ink-3">
                              {cell.sota && <span className="text-accent">★</span>}
                              {cell.rec.prov === 'lab' && <span title="lab-reported">○</span>}
                              {cell.rec.tools && <span title="with tools">t</span>}
                            </span>
                          </>
                        ) : (
                          <span className="text-ink-3/40">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>,
              ];
            })}
          </tbody>
        </table>
        </div>

        {/* Horizontal scrollbar pinned to the bottom of the screen, so you never hunt for it. */}
        {overflowing && (
          <div ref={barRef} className="sticky bottom-0 z-20 overflow-x-auto border-t border-line bg-[color-mix(in_oklab,var(--bg)_80%,transparent)] backdrop-blur" onScroll={(e) => syncFrom(e.currentTarget)}>
            <div style={{ width: totalW, height: 10 }} />
          </div>
        )}
      </div>
      <CellTooltip cols={cols} cells={cells} idx={idx} colIndex={colIndex} models={models} />
    </div>
  );
});

function CellTooltip({ cols, cells, idx, models }: { cols: Column[]; cells: Map<string, CellInfo>; idx: ScoreIndex; colIndex: Map<string, number>; models: Model[] }) {
  const h = useHover();
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  useEffect(() => {
    if (!h) return setPos(null);
    const below = h.y < 260;
    setPos({ left: Math.min(Math.max(h.x, 170), window.innerWidth - 170), top: below ? h.y + 44 : h.y - 8, below });
  }, [h]);
  if (!h || !pos) return null;
  const col = cols.find((c) => c.key === h.c)!;
  const cell = cells.get(`${h.m}|${h.c}`)!;
  const model = models.find((m) => m.id === h.m)!;
  const all = [...(idx.get(h.m)?.get(col.bench.id) ?? [])].sort((a, b) => b.v - a.v).slice(0, 6);
  return (
    <div
      className="pointer-events-none fixed z-50 w-[320px] -translate-x-1/2 rounded-xl border border-line-2 bg-surface-2/95 p-3 text-[12px] shadow-2xl backdrop-blur-xl"
      style={{ left: pos.left, top: pos.top, transform: `translate(-50%, ${pos.below ? '0' : '-100%'})` }}
    >
      <div className="kicker mb-1">
        {col.bench.name}
        {col.sub ? ` · ${col.sub}` : ''}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-ink">{model.name}</span>
        <span className="font-mono text-[18px] font-semibold text-ink">{fmtBench(cell.value, col.bench)}</span>
      </div>
      {cell.sota && <div className="mt-1 text-[11.5px] text-accent">★ State of the art at release</div>}
      <div className="mt-2 space-y-1 border-t border-line pt-2">
        {all.map((r, i) => (
          <div key={i} className="flex items-start justify-between gap-2 text-[11.5px]">
            <span className="min-w-0 text-ink-2">
              {r.prov === 'independent' ? '●' : '○'} {r.source ?? r.src}
              {r.effort ? ` · ${r.effort}` : ''}
              {r.tools ? ' · tools' : ''}
              {r.x?.harness ? ` · ${r.x.harness}` : ''}
              {r.setting ? <span className="block truncate text-ink-3">{r.setting}</span> : null}
            </span>
            <span className="shrink-0 font-mono text-ink">{fmtBench(r.v, col.bench)}</span>
          </div>
        ))}
        {cell.n > all.length && <div className="text-[11px] text-ink-3">+{cell.n - all.length} more · open the model for all results</div>}
      </div>
    </div>
  );
}
