import { motion, useInView, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode, type SVGAttributes } from 'react';
import { createPortal } from 'react-dom';
import { DateFilter, MultiSelect, SearchInput, ToggleFilter, type DatePreset, type Option } from '../../components/filters/Filters.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { Drawer, InfoTip, Legend } from '../../components/ui/misc.tsx';
import { ANY_DATE, countBy } from '../../lib/filters.ts';
import { monthYear, shortDate } from '../../lib/format.ts';
import { compact, datePill, multiPill, textPill } from '../charts/filterModel.ts';
import { filterMilestones, linkedProxies, proxiesInView, TRACK_EMPTY, trackActive, type TrackFacet, type TrackFilter } from './filters.ts';
import { fmtLag, type LagSummary, type ProxyLag } from './lag.ts';
import { connector, DOMAIN_END, DOMAIN_START, layoutTrack, makeScale, NODE_R, PAD_L, Y, type Layout, type ProxyGeom, type TrackNode } from './trackLayout.ts';
import type { Ai2027, Branch, Milestone, Proxy } from './types.ts';
import { Code, effectiveStatus, EmptyState, ExtLink, FilterRow, fmtClaim, fmtScenarioDate, Hl, hostOf, metricLabel, MILESTONE_STATUS, NoMatches, StatusBadge } from './ui.tsx';

type Handlers = SVGAttributes<SVGGElement>;

type Sel = { kind: 'm'; id: string } | { kind: 'p'; id: string };
type Zoom = '1' | '2' | '4';
type View = 'track' | 'list';

const BRANCH_LABEL: Record<Branch, string> = { shared: 'Shared timeline', race: 'Race ending', slowdown: 'Slowdown ending' };
const BRANCH_GLYPH: Record<Branch, string> = { shared: '━', race: '↗', slowdown: '↘' };
const STATUS_ORDER = ['hit', 'partial', 'not-yet', 'missed', 'future', 'n/a'] as const;

function trackPresets(now: string): DatePreset[] {
  const y = Number(now.slice(0, 4));
  return [
    { label: 'Already due', value: { mode: 'before', to: now } },
    { label: 'Still ahead', value: { mode: 'after', from: now } },
    ...[y - 1, y, y + 1].map((yy) => ({ label: String(yy), value: { mode: 'between' as const, from: `${yy}-01-01`, to: `${yy}-12-31` } })),
    { label: `${y + 2} and later`, value: { mode: 'after', from: `${y + 2}-01-01` } },
  ];
}

interface Props {
  ai2027: Ai2027 | null;
  proxies: Proxy[];
  summary: LagSummary;
  now: string;
}

export function TrackPanel({ ai2027, proxies, summary, now }: Props) {
  const [view, setView] = useState<View>('track');
  const [zoom, setZoom] = useState<Zoom>('2');
  const [open, setOpen] = useState<Sel | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const milestones = useMemo(() => ai2027?.milestones ?? [], [ai2027]);

  // ── filters ────────────────────────────────────────────────────────────
  const [f, setF] = useState<TrackFilter>(TRACK_EMPTY);
  const set = useCallback(<K extends keyof TrackFilter>(k: K, v: TrackFilter[K]) => setF((prev) => ({ ...prev, [k]: v })), []);
  const clear = useCallback(() => setF(TRACK_EMPTY), []);
  const active = trackActive(f);
  const ctx = useMemo(() => ({ now, proxies }), [now, proxies]);
  const matched = useMemo(() => new Set(filterMilestones(milestones, f, ctx).map((m) => m.id)), [milestones, f, ctx]);
  const proxyIn = useMemo(() => proxiesInView(proxies, milestones, matched, active), [proxies, milestones, matched, active]);
  const facets = useMemo(() => {
    const counts = (skip: TrackFacet, key: (m: Milestone) => string) => countBy(filterMilestones(milestones, f, ctx, skip), key);
    const bc = counts('branches', (m) => m.branch);
    const sc = counts('statuses', (m) => effectiveStatus(m, now));
    const present = new Set(milestones.map((m) => effectiveStatus(m, now)));
    return {
      branches: (['shared', 'race', 'slowdown'] as const).map((b): Option => ({ value: b, label: BRANCH_LABEL[b], count: bc.get(b) ?? 0, glyph: BRANCH_GLYPH[b], color: 'var(--text-2)' })),
      statuses: STATUS_ORDER.filter((k) => present.has(k)).map((k): Option => ({ value: k, label: MILESTONE_STATUS[k].label, count: sc.get(k) ?? 0, glyph: MILESTONE_STATUS[k].icon, color: MILESTONE_STATUS[k].color })),
      withProxy: filterMilestones(milestones, f, ctx, 'hasProxy').filter((m) => linkedProxies(m, proxies).length > 0).length,
      marks: new Set(milestones.map((m) => m.date)),
    };
  }, [milestones, f, ctx, now, proxies]);
  const presets = useMemo(() => trackPresets(now), [now]);
  const labelOf = (opts: Option[]) => (v: string) => opts.find((o) => o.value === v)?.label ?? v;
  const pills = compact([
    textPill('q', f.q, () => set('q', '')),
    multiPill('branches', 'Branch', f.branches, labelOf(facets.branches), () => set('branches', [])),
    multiPill('statuses', 'Status', f.statuses, labelOf(facets.statuses), () => set('statuses', [])),
    datePill('date', 'Scenario date', f.date, () => set('date', ANY_DATE)),
    f.hasProxy && { key: 'proxy', label: 'Has proxy', onClear: () => set('hasProxy', false) },
  ]);

  const actions = milestones.length ? (
    <>
      {view === 'track' && (
        <Segmented
          label="Zoom"
          value={zoom}
          onChange={setZoom}
          options={[
            { value: '1', label: 'Fit', title: 'Fit the whole scenario' },
            { value: '2', label: '2×' },
            { value: '4', label: '4×' },
          ]}
        />
      )}
      <Segmented
        label="View"
        value={view}
        onChange={setView}
        options={[
          { value: 'track', label: 'Track' },
          { value: 'list', label: 'List' },
        ]}
      />
    </>
  ) : undefined;

  return (
    <Panel
      kicker={
        <span className="inline-flex items-center gap-1.5">
          AI 2027 track · scenario vs reality
          <InfoTip align="left">
            Top: the AI 2027 scenario ({ai2027?.published ? monthYear(ai2027.published) : 'Apr 2025'}), one shared rail that forks in {monthYear(forkDateOf(milestones) ?? '2027-10-01')} into the Race and Slowdown endings. Bottom: when reality actually
            reached each measurable proxy. The curves join the two, so a curve leaning right means reality got there later (behind); leaning left means earlier (ahead). Hover for detail, click for sources.
          </InfoTip>
        </span>
      }
      title="Where the scenario said we’d be, and where we are"
      actions={actions}
      footer={
        ai2027?.source ? (
          <span>
            Scenario: <ExtLink href={ai2027.source}>{hostOf(ai2027.source)}</ExtLink> · grading and proxies are curated in <Code>data/curated/ai2027*.yaml</Code>. Status colours mark state only.
          </span>
        ) : undefined
      }
    >
      {!ai2027 || milestones.length === 0 ? (
        <EmptyState title="No scenario data">
          Curated file missing: <Code>data/curated/ai2027.yaml</Code>. Add it and run <Code>npm run build:data</Code>.
        </EmptyState>
      ) : (
        <>
          <FilterRow pills={pills} onClearAll={clear} count={matched.size} total={milestones.length} noun="milestones">
            <SearchInput value={f.q} onChange={(v) => set('q', v)} placeholder="Search milestones, claims…" className="w-full sm:w-56" />
            <MultiSelect label="Branch" options={facets.branches} value={f.branches} onChange={(v) => set('branches', v)} width={250} />
            <MultiSelect label="Status" options={facets.statuses} value={f.statuses} onChange={(v) => set('statuses', v)} width={240} />
            <DateFilter label="Scenario date" value={f.date} onChange={(v) => set('date', v)} marks={facets.marks} presets={presets} minYear={2025} />
            <ToggleFilter label={`Has proxy (${facets.withProxy})`} value={f.hasProxy} onChange={(v) => set('hasProxy', v)} title="Only milestones measured by a real-world proxy" />
          </FilterRow>
          <TrackLegend hasProxies={proxies.length > 0} />
          {view === 'track' ? (
            <>
              {active && matched.size === 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                  No milestone matches these filters; everything on the track is faded.
                  <button type="button" onClick={clear} className="underline decoration-line-2 underline-offset-2 hover:text-ink">
                    Clear filters
                  </button>
                </div>
              )}
              <TrackCanvas milestones={milestones} proxies={proxies} lags={summary.lags} now={now} zoom={Number(zoom)} onOpen={setOpen} matched={active ? matched : null} proxyIn={active ? proxyIn : null} />
            </>
          ) : matched.size ? (
            <TrackList milestones={milestones.filter((m) => matched.has(m.id))} now={now} onOpen={setOpen} q={f.q} />
          ) : (
            <NoMatches onClear={clear}>No milestone matches these filters.</NoMatches>
          )}
          {proxies.length === 0 && (
            <p className="mt-3 text-[12px] text-ink-3">
              The reality rail is empty: <Code>data/curated/ai2027-proxies.yaml</Code> is missing, so no lag connectors can be drawn.
            </p>
          )}
        </>
      )}
      <DetailDrawer sel={open} onClose={close} milestones={milestones} proxies={proxies} lags={summary.lags} now={now} onOpen={setOpen} />
    </Panel>
  );
}

const forkDateOf = (ms: Milestone[]) => ms.filter((m) => m.branch === 'shared').reduce<string | null>((a, m) => (!a || m.date > a ? m.date : a), null);

function TrackLegend({ hasProxies }: { hasProxies: boolean }) {
  const s = MILESTONE_STATUS;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
      <Legend
        items={(['hit', 'partial', 'not-yet', 'missed', 'future'] as const).map((k) => ({ label: s[k].label, color: s[k].color, glyph: s[k].icon }))}
      />
      {hasProxies && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2" style={{ borderColor: 'var(--tl-behind)' }} />
            reached later (behind)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2" style={{ borderColor: 'var(--tl-ahead)' }} />
            reached earlier (ahead)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--text-2)' }} />
            not yet: projected / ≥ lower bound
          </span>
        </div>
      )}
    </div>
  );
}

// ── The SVG track ──────────────────────────────────────────────────────────
interface Hover {
  sel: Sel;
  x: number;
  y: number;
}

function TrackCanvas({
  milestones,
  proxies,
  lags,
  now,
  zoom,
  onOpen,
  matched,
  proxyIn,
}: {
  milestones: Milestone[];
  proxies: Proxy[];
  lags: ProxyLag[];
  now: string;
  zoom: number;
  onOpen: (s: Sel) => void;
  /** milestones passing the filters (null = no filter): the rest fade in place, so the layout never moves */
  matched: Set<string> | null;
  proxyIn: Set<string> | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(1200);
  const [hover, setHover] = useState<Hover | null>(null);
  const [flat, setFlat] = useState(false);
  const [canHover, setCanHover] = useState(false);
  const reduce = useReducedMotion();
  const inView = useInView(wrap, { once: true, amount: 0.25 });

  useEffect(() => {
    // Resting tilt only where a pointer can hover to flatten it (not on touch screens).
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    setCanHover(mq.matches);
    const on = () => setCanHover(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setCw(el.clientWidth);
    const ro = new ResizeObserver(() => setCw(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => layoutTrack(milestones, proxies, lags, now, makeScale(cw, zoom)), [milestones, proxies, lags, now, cw, zoom]);

  // Keep NOW in view when the zoom or width changes.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, layout.nowX - el.clientWidth * 0.42);
  }, [layout.nowX]);

  const show = useCallback((sel: Sel, target: Element) => {
    const w = wrap.current;
    if (!w) return;
    const r = target.getBoundingClientRect();
    const wr = w.getBoundingClientRect();
    setHover({ sel, x: r.left + r.width / 2 - wr.left, y: r.top + r.height / 2 - wr.top });
  }, []);
  const hide = useCallback(() => setHover(null), []);

  const active = hover?.sel ?? null;
  const linkedProxyIds = useMemo(() => {
    if (!active) return null;
    if (active.kind === 'p') return new Set([active.id]);
    const m = milestones.find((x) => x.id === active.id);
    return new Set(proxies.filter((p) => p.scenarioRef === active.id || (m?.proxy && p.id === m.proxy)).map((p) => p.id));
  }, [active, milestones, proxies]);
  const linkedMilestoneId = active?.kind === 'p' ? proxies.find((p) => p.id === active.id)?.scenarioRef ?? null : active?.id ?? null;

  const handlers = (sel: Sel): Handlers => ({
    tabIndex: 0,
    role: 'button',
    onPointerEnter: (e: PointerEvent<SVGGElement>) => show(sel, e.currentTarget),
    onPointerLeave: hide,
    onFocus: (e: FocusEvent<SVGGElement>) => show(sel, e.currentTarget),
    onBlur: hide,
    onClick: () => onOpen(sel),
    onKeyDown: (e: KeyboardEvent<SVGGElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen(sel);
      }
    },
    style: { cursor: 'pointer', outline: 'none' },
  });

  const { scale } = layout;
  const tilt = reduce || flat || !canHover ? 0 : 7;

  return (
    <div ref={wrap} className="relative">
      {/* Pinned rail names (stay visible while the track scrolls) */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10" aria-hidden>
        {[
          ['Scenario', Y.shared + 8],
          ['Reality', Y.reality - 30],
        ].map(([t, y]) => (
          <span key={t} className="kicker absolute left-1 rounded-md border border-line bg-surface/80 px-1.5 py-0.5 backdrop-blur" style={{ top: y as number, fontSize: 9.5, color: 'var(--text-2)' }}>
            {t}
          </span>
        ))}
      </div>

      <div
        ref={scroller}
        className="overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-xl"
        onScroll={hide}
        onPointerEnter={() => setFlat(true)}
        onPointerLeave={() => setFlat(false)}
        onFocus={() => setFlat(true)}
        tabIndex={-1}
      >
        <motion.div
          style={{ width: scale.width, transformPerspective: 1600, transformOrigin: '50% 100%' }}
          initial={reduce ? false : { rotateX: 24, opacity: 0, y: 12 }}
          animate={inView || reduce ? { rotateX: tilt, opacity: 1, y: 0 } : { rotateX: 24, opacity: 0, y: 12 }}
          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
        >
          <svg width={scale.width} height={Y.height} viewBox={`0 0 ${scale.width} ${Y.height}`} className="block select-none" role="group" aria-label="AI 2027 milestones against real-world proxy dates">
            <TrackDefs />
            <Axis layout={layout} now={now} />
            <Rails layout={layout} reduce={!!reduce} />
            <Connectors layout={layout} reduce={!!reduce} highlight={linkedProxyIds} proxyIn={proxyIn} />
            {/* scenario-side proxy ticks */}
            {layout.proxies.map((g) => (
              <g
                key={`t-${g.p.id}`}
                {...handlers({ kind: 'p', id: g.p.id })}
                opacity={proxyIn && !proxyIn.has(g.p.id) ? FADED : 1}
                aria-label={`Proxy ${g.p.name}, scenario date ${shortDate(g.p.scenarioDate)}`}
              >
                <rect x={g.sx - 12} y={g.sy - 12} width="24" height="24" fill="transparent" />
                <path d={`M${g.sx},${g.sy - 4.5} l4.5,4.5 l-4.5,4.5 l-4.5,-4.5 Z`} fill="var(--surface)" stroke={linkedProxyIds?.has(g.p.id) ? 'var(--text)' : 'var(--text-2)'} strokeWidth="1.3" />
              </g>
            ))}
            {/* milestone nodes */}
            {layout.nodes.map((n) => (
              <MilestoneNode
                key={n.m.id}
                n={n}
                now={now}
                dim={!!active && linkedMilestoneId !== n.m.id && !(active.kind === 'm' && active.id === n.m.id)}
                faded={!!matched && !matched.has(n.m.id)}
                focused={linkedMilestoneId === n.m.id}
                handlers={handlers({ kind: 'm', id: n.m.id })}
              />
            ))}
            {/* reality nodes */}
            {layout.proxies.map((g) => (
              <RealityNode
                key={`r-${g.p.id}`}
                g={g}
                dim={!!linkedProxyIds && !linkedProxyIds.has(g.p.id)}
                faded={!!proxyIn && !proxyIn.has(g.p.id)}
                focused={!!linkedProxyIds?.has(g.p.id)}
                handlers={handlers({ kind: 'p', id: g.p.id })}
              />
            ))}
          </svg>
        </motion.div>
      </div>

      {hover && <HoverCard hover={hover} wrapWidth={wrap.current?.clientWidth ?? 800} milestones={milestones} proxies={proxies} lags={lags} now={now} />}
      <p className="mt-2 text-[11.5px] text-ink-3 sm:hidden">Swipe sideways to scroll the timeline. Tap a node for details.</p>
    </div>
  );
}

function TrackDefs() {
  return (
    <defs>
      <linearGradient id="tl-rail" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="var(--glow-a)" />
        <stop offset="1" stopColor="var(--glow-b)" />
      </linearGradient>
      <filter id="tl-glow" x="-20%" y="-200%" width="140%" height="500%">
        <feGaussianBlur stdDeviation="3.5" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="tl-now" x="-400%" y="-10%" width="900%" height="120%">
        <feGaussianBlur stdDeviation="5" />
      </filter>
      {(['ahead', 'behind', 'even'] as const).map((k) => (
        <marker key={k} id={`tl-arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,1 L9,5 L0,9 Z" fill={`var(--tl-${k})`} />
        </marker>
      ))}
    </defs>
  );
}

function Axis({ layout, now }: { layout: Layout; now: string }) {
  const { scale, nowX } = layout;
  const years: number[] = [];
  for (let y = Number(DOMAIN_START.slice(0, 4)); y <= Number(DOMAIN_END.slice(0, 4)); y++) years.push(y);
  const quarters: string[] = [];
  for (const y of years) for (const m of ['01', '04', '07', '10']) {
    const d = `${y}-${m}-01`;
    if (d >= DOMAIN_START && d <= DOMAIN_END) quarters.push(d);
  }
  const showMonths = scale.ppm >= 34;
  // Put the date beside the NOW pill on whichever side clears the year labels (or drop it).
  const nowYear = Number(now.slice(0, 4));
  const nextJan = scale.x(`${nowYear + 1}-01-01`);
  const prevJan = scale.x(`${nowYear}-01-01`);
  const dateW = shortDate(now).length * 6.2;
  const dateSide = nextJan - (nowX + 26) > dateW + 8 ? 'right' : nowX - 26 - (prevJan + 36) > dateW ? 'left' : null;
  return (
    <g aria-hidden>
      {quarters.map((d) => {
        const x = scale.x(d);
        const jan = d.endsWith('-01-01');
        return (
          <g key={d}>
            {jan && <line x1={x} x2={x} y1={26} y2={Y.height - 6} stroke="var(--grid)" />}
            <line x1={x} x2={x} y1={jan ? 18 : 22} y2={28} stroke={jan ? 'var(--text-3)' : 'var(--axis)'} />
            {jan ? (
              <text x={x + 4} y={Y.axis + 4} fontSize="11" className="font-mono" fill="var(--text-2)" fontWeight={600}>
                {d.slice(0, 4)}
              </text>
            ) : (
              showMonths && (
                <text x={x + 3} y={Y.axis + 4} fontSize="9.5" className="font-mono" fill="var(--text-3)">
                  {monthYear(d).slice(0, 3)}
                </text>
              )
            )}
          </g>
        );
      })}
      <line x1={PAD_L - 6} x2={scale.endX} y1={28} y2={28} stroke="var(--axis)" />
      {/* axis break → overflow zone */}
      <g transform={`translate(${scale.endX + 12},28)`}>
        <path d="M-4,5 L2,-5 M2,5 L8,-5" stroke="var(--text-3)" strokeWidth="1.2" />
      </g>
      <line x1={scale.endX + 22} x2={scale.overflowX + 22} y1={28} y2={28} stroke="var(--axis)" />
      <text x={scale.overflowX} y={Y.axis + 4} fontSize="10" textAnchor="middle" className="font-mono" fill="var(--text-3)">
        later
      </text>

      {/* NOW */}
      {nowX >= PAD_L && nowX <= scale.endX && (
        <g>
          <line x1={nowX} x2={nowX} y1={30} y2={Y.reality + 12} stroke="var(--accent)" strokeWidth="7" opacity="0.28" filter="url(#tl-now)" className="live-dot" />
          <line x1={nowX} x2={nowX} y1={30} y2={Y.reality + 12} stroke="var(--accent)" strokeWidth="1.5" />
          <rect x={nowX - 20} y={Y.axis - 9} width="40" height="17" rx="8.5" fill="var(--accent)" />
          <text x={nowX} y={Y.axis + 3} fontSize="10" textAnchor="middle" className="font-mono" fontWeight={700} fill="var(--accent-ink)" letterSpacing="0.08em">
            NOW
          </text>
          {dateSide && (
            <text x={dateSide === 'right' ? nowX + 26 : nowX - 26} y={Y.axis + 3} fontSize="10" textAnchor={dateSide === 'right' ? 'start' : 'end'} className="font-mono" fill="var(--text-2)">
              {shortDate(now)}
            </text>
          )}
        </g>
      )}
    </g>
  );
}

function Rails({ layout, reduce }: { layout: Layout; reduce: boolean }) {
  const { scale, railEnds, forkX, nowX } = layout;
  const draw = (delay = 0) =>
    reduce
      ? {}
      : { initial: { pathLength: 0 }, whileInView: { pathLength: 1 }, viewport: { once: true }, transition: { duration: 1.1, delay, ease: [0.22, 1, 0.36, 1] as const } };
  const sh = railEnds.shared;
  const elapsedTo = sh ? Math.min(Math.max(nowX, sh.from), forkX ?? sh.to) : 0;
  const realityEnd = Math.min(nowX, scale.endX);
  return (
    <g aria-hidden>
      {sh && (
        <>
          <line x1={sh.from} x2={forkX ?? sh.to} y1={Y.shared} y2={Y.shared} stroke="var(--line-2)" strokeWidth="2" />
          <motion.path d={`M${sh.from},${Y.shared} L${elapsedTo},${Y.shared}`} stroke="url(#tl-rail)" strokeWidth="2.5" fill="none" filter="url(#tl-glow)" strokeLinecap="round" {...draw()} />
        </>
      )}
      {forkX != null &&
        (['race', 'slowdown'] as const).map((b, i) => {
          const e = railEnds[b];
          if (!e) return null;
          const y = Y[b];
          return (
            <g key={b}>
              <motion.path
                d={`M${forkX},${Y.shared} L${forkX},${y} L${Math.max(e.to, forkX + 10)},${y}`}
                stroke="var(--line-2)"
                strokeWidth="2"
                fill="none"
                {...draw(0.5 + i * 0.1)}
              />
              <text x={forkX - 12} y={y + 4} textAnchor="end" fontSize="9.5" className="font-mono" fill="var(--text-3)" letterSpacing="0.12em">
                {b === 'race' ? 'RACE ENDING ↗' : 'SLOWDOWN ENDING ↘'}
              </text>
            </g>
          );
        })}
      {/* reality rail: solid up to now, dashed beyond (projections only) */}
      <motion.path d={`M${PAD_L},${Y.reality} L${realityEnd},${Y.reality}`} stroke="var(--text-3)" strokeWidth="2" fill="none" strokeLinecap="round" {...draw(0.2)} />
      <line x1={realityEnd} x2={scale.endX} y1={Y.reality} y2={Y.reality} stroke="var(--line-2)" strokeWidth="1.5" strokeDasharray="3 5" />
      {nowX < scale.endX - 80 && (
        <text x={nowX + 16} y={Y.reality - 8} fontSize="9.5" className="font-mono" fill="var(--text-3)" letterSpacing="0.1em">
          PROJECTED →
        </text>
      )}
    </g>
  );
}

/** Opacity for nodes filtered out of view (they stay in place so the layout never jumps). */
const FADED = 0.12;

function Connectors({ layout, reduce, highlight, proxyIn }: { layout: Layout; reduce: boolean; highlight: Set<string> | null; proxyIn: Set<string> | null }) {
  return (
    <g aria-hidden>
      {layout.proxies.map((g, i) => {
        if (g.ex == null) return null;
        const col = lagKey(g.lag.months);
        const dashed = g.lag.kind !== 'reached';
        const on = (!highlight || highlight.has(g.p.id)) && (!proxyIn || proxyIn.has(g.p.id));
        const d = connector(g.sx, g.sy + 5, g.ex, g.ey - (dashed ? 9 : NODE_R - 1));
        const common = {
          d,
          fill: 'none',
          stroke: `var(--tl-${col})`,
          strokeWidth: highlight?.has(g.p.id) ? 2.6 : 1.7,
          strokeOpacity: on ? 0.9 : 0.14,
          style: { transition: 'stroke-opacity .2s, stroke-width .2s' },
        };
        if (dashed)
          return (
            <motion.path
              key={g.p.id}
              {...common}
              strokeDasharray="5 4"
              markerEnd={`url(#tl-arrow-${col})`}
              initial={reduce ? false : { opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.9 + i * 0.05 }}
            />
          );
        return (
          <motion.path
            key={g.p.id}
            {...common}
            initial={reduce ? false : { pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, delay: 0.6 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
          />
        );
      })}
    </g>
  );
}

const lagKey = (m: number | null) => (m == null || Math.abs(m) < 0.5 ? 'even' : m > 0 ? 'behind' : 'ahead');

function StatusGlyph({ x, y, status, r = NODE_R }: { x: number; y: number; status: ReturnType<typeof effectiveStatus>; r?: number }) {
  const c = MILESTONE_STATUS[status].color;
  switch (status) {
    case 'hit':
      return (
        <g>
          <circle cx={x} cy={y} r={r} fill={c} />
          <path d={`M${x - 3.2},${y + 0.2} l2.2,2.3 l4.2,-4.6`} fill="none" stroke="var(--surface)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    case 'partial':
      return (
        <g>
          <circle cx={x} cy={y} r={r} fill="var(--surface)" stroke={c} strokeWidth="1.8" />
          <path d={`M${x},${y - r + 1.6} A${r - 1.6},${r - 1.6} 0 0 0 ${x},${y + r - 1.6} Z`} fill={c} />
        </g>
      );
    case 'not-yet':
      return <circle cx={x} cy={y} r={r - 0.5} fill="var(--surface)" stroke={c} strokeWidth="1.8" />;
    case 'missed':
      return (
        <g>
          <circle cx={x} cy={y} r={r} fill={c} />
          <path d={`M${x - 2.6},${y - 2.6} l5.2,5.2 M${x + 2.6},${y - 2.6} l-5.2,5.2`} stroke="var(--surface)" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      );
    default:
      return (
        <g>
          <circle cx={x} cy={y} r={r - 2} fill="var(--surface)" stroke="var(--line-2)" strokeWidth="1.2" />
          <circle cx={x} cy={y} r={1.7} fill="var(--text-3)" />
        </g>
      );
  }
}

function MilestoneNode({ n, now, dim, faded, focused, handlers }: { n: TrackNode; now: string; dim: boolean; faded: boolean; focused: boolean; handlers: Handlers }) {
  const st = effectiveStatus(n.m, now);
  const past = st !== 'future';
  return (
    <g
      {...handlers}
      aria-label={`${n.m.title}, ${fmtScenarioDate(n.m.date, n.m.datePrecision)}, ${MILESTONE_STATUS[st].label}${faded ? ', filtered out' : ''}`}
      style={{ ...(handlers.style as object), opacity: faded ? FADED : dim ? 0.35 : 1, transition: 'opacity .2s' }}
    >
      {n.stacked && <line x1={n.x} x2={n.x} y1={n.railY} y2={n.y} stroke="var(--line-2)" strokeWidth="1" />}
      {n.label && <line x1={n.label.lx} x2={n.label.lx} y1={n.label.ly1} y2={n.label.ly2} stroke="var(--line-2)" strokeWidth="1" />}
      <circle cx={n.x} cy={n.y} r={14} fill="transparent" />
      {focused && <circle cx={n.x} cy={n.y} r={NODE_R + 4.5} fill="none" stroke="var(--accent)" strokeWidth="1.5" />}
      <StatusGlyph x={n.x} y={n.y} status={st} />
      {n.label && (
        <text x={n.label.x} y={n.label.y} textAnchor={n.label.anchor} fontSize="11" fill={focused ? 'var(--text)' : past ? 'var(--text-2)' : 'var(--text-3)'} fontWeight={past ? 500 : 400}>
          {n.label.text}
        </text>
      )}
    </g>
  );
}

function RealityNode({ g, dim, faded, focused, handlers }: { g: ProxyGeom; dim: boolean; faded: boolean; focused: boolean; handlers: Handlers }) {
  if (g.ex == null) return null;
  const col = `var(--tl-${lagKey(g.lag.months)})`;
  const kind = g.lag.kind;
  return (
    <g
      {...handlers}
      aria-label={`${g.p.name}: ${fmtLag(g.lag.months, g.lag.atLeast)}${kind === 'projected' ? ' projected' : ''}`}
      style={{ ...(handlers.style as object), opacity: faded ? FADED : dim ? 0.35 : 1, transition: 'opacity .2s' }}
    >
      {g.label && <line x1={g.label.lx} x2={g.label.lx} y1={g.label.ly1} y2={g.label.ly2} stroke="var(--line-2)" strokeWidth="1" />}
      <circle cx={g.ex} cy={g.ey} r={13} fill="transparent" />
      {focused && <circle cx={g.ex} cy={g.ey} r={NODE_R + 4} fill="none" stroke="var(--accent)" strokeWidth="1.5" />}
      {kind === 'reached' ? (
        <circle cx={g.ex} cy={g.ey} r={NODE_R - 1.5} fill={col} stroke="var(--surface)" strokeWidth="2" />
      ) : (
        <circle cx={g.ex} cy={g.ey} r={NODE_R - 1.5} fill="var(--surface)" stroke={col} strokeWidth="1.6" strokeDasharray="2.5 2" />
      )}
      {g.label && (
        <text x={g.label.x} y={g.label.y} textAnchor={g.label.anchor} fontSize="11" fill={focused ? 'var(--text)' : 'var(--text-2)'}>
          {g.label.text}
        </text>
      )}
    </g>
  );
}

// ── Hover card ─────────────────────────────────────────────────────────────
function HoverCard({ hover, wrapWidth, milestones, proxies, lags, now }: { hover: Hover; wrapWidth: number; milestones: Milestone[]; proxies: Proxy[]; lags: ProxyLag[]; now: string }) {
  const W = 320;
  const left = hover.x + 18 + W > wrapWidth ? Math.max(4, hover.x - 18 - W) : hover.x + 18;
  const above = hover.y > Y.height * 0.55;
  const style = above ? { left, bottom: `calc(100% - ${hover.y - 10}px)` } : { left, top: hover.y - 10 };
  let body: ReactNode = null;
  if (hover.sel.kind === 'm') {
    const m = milestones.find((x) => x.id === hover.sel.id);
    if (!m) return null;
    const st = effectiveStatus(m, now);
    body = (
      <>
        <div className="kicker mb-1">
          {BRANCH_LABEL[m.branch]} · {fmtScenarioDate(m.date, m.datePrecision)}
        </div>
        <div className="mb-2 text-[13.5px] font-semibold leading-snug text-ink">{m.title}</div>
        <StatusBadge status={st} />
        {m.summary && <p className="mt-2 line-clamp-4 text-[12px] leading-relaxed text-ink-2">{m.summary}</p>}
        {!!m.claims?.length && (
          <ul className="mt-2 space-y-0.5 text-[11.5px] text-ink-2">
            {m.claims.slice(0, 4).map((c, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="truncate text-ink-3">{metricLabel(c.metric)}</span>
                <span className="tnum shrink-0 text-ink">{fmtClaim(c.metric, c.value)}</span>
              </li>
            ))}
            {m.claims.length > 4 && <li className="text-ink-3">+{m.claims.length - 4} more</li>}
          </ul>
        )}
        {m.statusNote && <p className="mt-2 border-t border-line pt-2 text-[11.5px] leading-relaxed text-ink-2">{m.statusNote}</p>}
        <div className="mt-2 text-[10.5px] text-ink-3">Click for full details and sources</div>
      </>
    );
  } else {
    const i = proxies.findIndex((p) => p.id === hover.sel.id);
    const p = proxies[i];
    const l = lags[i];
    if (!p || !l) return null;
    body = (
      <>
        <div className="kicker mb-1">Proxy · weight {p.weight}</div>
        <div className="mb-2 text-[13.5px] font-semibold leading-snug text-ink">{p.name}</div>
        <div className="flex items-baseline gap-2">
          <span className="text-[22px] font-semibold leading-none tracking-tight text-ink">{fmtLag(l.months, l.atLeast)}</span>
          <span className="text-[12px] text-ink-3">{l.kind === 'reached' ? (l.months! > 0 ? 'behind' : 'ahead') : l.kind === 'projected' ? 'projected' : l.kind === 'lower-bound' ? 'and counting' : 'not countable yet'}</span>
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px]">
          <dt className="text-ink-3">Scenario</dt>
          <dd className="tnum text-ink-2">{shortDate(p.scenarioDate)}</dd>
          <dt className="text-ink-3">{l.kind === 'reached' ? 'Reality' : l.kind === 'projected' ? 'Projected' : 'Reality'}</dt>
          <dd className="tnum text-ink-2">{l.kind === 'reached' || l.kind === 'projected' ? shortDate(l.endDate!) : 'not yet'}</dd>
        </dl>
        {p.realityRef && <p className="mt-2 line-clamp-3 text-[11.5px] leading-relaxed text-ink-2">{p.realityRef}</p>}
        <div className="mt-2 text-[10.5px] text-ink-3">Click for the note and sources</div>
      </>
    );
  }
  return (
    <div className="pointer-events-none absolute z-30 rounded-xl border border-line-2 bg-surface-2/95 p-3 shadow-2xl backdrop-blur-md" style={{ ...style, width: W, maxWidth: 'calc(100vw - 32px)' }}>
      {body}
    </div>
  );
}

// ── List view (accessibility twin of the track) ────────────────────────────
function TrackList({ milestones, now, onOpen, q }: { milestones: Milestone[]; now: string; onOpen: (s: Sel) => void; q: string }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {(['shared', 'race', 'slowdown'] as const).map((b) => {
        const ms = milestones.filter((m) => m.branch === b).sort((a, z) => a.date.localeCompare(z.date));
        if (!ms.length) return null;
        return (
          <div key={b} className="min-w-0">
            <div className="kicker mb-2">{BRANCH_LABEL[b]}</div>
            <ol className="space-y-1">
              {ms.map((m) => {
                const st = effectiveStatus(m, now);
                const s = MILESTONE_STATUS[st];
                return (
                  <li key={m.id}>
                    <button onClick={() => onOpen({ kind: 'm', id: m.id })} className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-3/60">
                      <span aria-label={s.label} className="mt-0.5 w-3 shrink-0 text-center text-[12px] leading-none" style={{ color: s.color }}>
                        {s.icon}
                      </span>
                      <span className="tnum w-[68px] shrink-0 font-mono text-[11px] text-ink-3">{fmtScenarioDate(m.date, m.datePrecision)}</span>
                      <span className="min-w-0 text-[12.5px] leading-snug text-ink-2">
                        <Hl text={m.title} q={q} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

// ── Drawer ─────────────────────────────────────────────────────────────────
function DetailDrawer({ sel, onClose, milestones, proxies, lags, now, onOpen }: { sel: Sel | null; onClose: () => void; milestones: Milestone[]; proxies: Proxy[]; lags: ProxyLag[]; now: string; onOpen: (s: Sel) => void }) {
  const m = sel?.kind === 'm' ? milestones.find((x) => x.id === sel.id) : undefined;
  const pi = sel?.kind === 'p' ? proxies.findIndex((x) => x.id === sel.id) : -1;
  const p = pi >= 0 ? proxies[pi] : undefined;
  const l = pi >= 0 ? lags[pi] : undefined;
  const linked = m ? proxies.map((x, i) => ({ x, l: lags[i] })).filter(({ x }) => x.scenarioRef === m.id || m.proxy === x.id) : [];
  const ref = p?.scenarioRef ? milestones.find((x) => x.id === p.scenarioRef) : undefined;

  // Portal to <body>: ancestors with backdrop-filter / filter (Panel, the tab transition) would
  // otherwise become the containing block for the drawer's `position: fixed`.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <Drawer
      open={!!sel && (!!m || !!p)}
      onClose={onClose}
      kicker={m ? `${BRANCH_LABEL[m.branch]} · ${fmtScenarioDate(m.date, m.datePrecision)}` : p ? 'Measurable proxy' : undefined}
      title={m?.title ?? p?.name}
    >
      {m && (
        <div className="space-y-5 text-[13px] leading-relaxed text-ink-2">
          <StatusBadge status={effectiveStatus(m, now)} />
          {m.summary && (
            <section>
              <div className="kicker mb-1.5">What the scenario says</div>
              <p>{m.summary}</p>
            </section>
          )}
          {!!m.claims?.length && (
            <section>
              <div className="kicker mb-1.5">Quantitative claims</div>
              <table className="w-full text-[12px]">
                <tbody>
                  {m.claims.map((c, i) => (
                    <tr key={i} className="border-t border-line align-top">
                      <td className="py-1.5 pr-3 text-ink-3">{metricLabel(c.metric)}</td>
                      <td className="tnum whitespace-nowrap py-1.5 pr-3 text-right font-medium text-ink">{fmtClaim(c.metric, c.value)}</td>
                      <td className="py-1.5 text-ink-3">{c.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <section>
            <div className="kicker mb-1.5">Reality check</div>
            <p>{m.statusNote ?? 'No grading note yet.'}</p>
            {m.evidenceUrl && (
              <p className="mt-2">
                Evidence: <ExtLink href={m.evidenceUrl}>{hostOf(m.evidenceUrl)}</ExtLink>
              </p>
            )}
          </section>
          {linked.length > 0 && (
            <section>
              <div className="kicker mb-1.5">Linked proxies</div>
              <ul className="space-y-1">
                {linked.map(({ x, l: ll }) => (
                  <li key={x.id}>
                    <button onClick={() => onOpen({ kind: 'p', id: x.id })} className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1 text-left hover:bg-surface-3/60">
                      <span className="text-ink-2">{x.name}</span>
                      <span className="tnum shrink-0 font-medium text-ink">{fmtLag(ll?.months ?? null, ll?.atLeast)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {p && l && (
        <div className="space-y-5 text-[13px] leading-relaxed text-ink-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[34px] font-semibold leading-none tracking-tight text-ink">{fmtLag(l.months, l.atLeast)}</span>
            <span className="text-ink-3">{l.kind === 'projected' ? 'projected lag' : l.kind === 'lower-bound' ? 'lower bound, growing' : l.kind === 'excluded' ? `not counted (${l.reason})` : l.months! > 0 ? 'behind' : 'ahead'}</span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12.5px]">
            <dt className="text-ink-3">Scenario date</dt>
            <dd className="tnum">{shortDate(p.scenarioDate)}</dd>
            {p.realityDate && (
              <>
                <dt className="text-ink-3">Reality date</dt>
                <dd className="tnum">{shortDate(p.realityDate)}</dd>
              </>
            )}
            {p.projectedDate && (
              <>
                <dt className="text-ink-3">Projected</dt>
                <dd className="tnum">{shortDate(p.projectedDate)}</dd>
              </>
            )}
            <dt className="text-ink-3">Weight</dt>
            <dd>{p.weight}</dd>
            {ref && (
              <>
                <dt className="text-ink-3">Scenario section</dt>
                <dd>
                  <button className="text-left underline decoration-line-2 underline-offset-2 hover:text-ink" onClick={() => onOpen({ kind: 'm', id: ref.id })}>
                    {ref.title}
                  </button>
                </dd>
              </>
            )}
          </dl>
          {p.realityRef && (
            <section>
              <div className="kicker mb-1.5">Observation</div>
              <p>{p.realityRef}</p>
            </section>
          )}
          {p.projectionNote && (
            <section>
              <div className="kicker mb-1.5">Projection</div>
              <p>{p.projectionNote}</p>
            </section>
          )}
          {p.note && (
            <section>
              <div className="kicker mb-1.5">Caveats</div>
              <p>{p.note}</p>
            </section>
          )}
          {!!p.sources?.length && (
            <section>
              <div className="kicker mb-1.5">Sources</div>
              <ul className="space-y-1">
                {p.sources.map((s) => (
                  <li key={s} className="truncate">
                    <ExtLink href={s}>{hostOf(s)}</ExtLink> <span className="text-ink-3">{s.replace(/^https?:\/\/[^/]+/, '').slice(0, 60)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Drawer>,
    document.body,
  );
}
