import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { EciPoint, LabGroup } from '../../../shared/types.ts';
import type { SpaceAxis, SpacePoint } from '../../components/three/CapabilitySpace.tsx';
import { Chip } from '../../components/ui/Chip.tsx';
import { ErrorBoundary, Legend, Skeleton } from '../../components/ui/misc.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { useCore, useTrends } from '../../lib/data.ts';
import { frontier } from '../../lib/fit.ts';
import { fmtFlop, monthYear, yearFrac } from '../../lib/format.ts';
import { LAB_META, labVar } from '../../lib/labs.ts';
import { useTokens } from '../../lib/tokens.ts';
import { openModel } from '../../lib/ui-state.ts';
import { ClearFiltersButton, DataTable, EmptyState, fmtHorizon, LabCell, useReducedMotion, ViewToggle, type View } from './common.tsx';
import { ALL_GROUPS, useChartFilters, useModelScope } from './filters.tsx';

const CapabilitySpace = lazy(() => import('../../components/three/CapabilitySpace.tsx'));

type ZMode = 'compute' | 'metr' | 'lanes';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Year ticks, or half-year ticks when the window is short. */
function timeTicks(lo: number, hi: number): SpaceAxis['ticks'] {
  const years: SpaceAxis['ticks'] = [];
  for (let y = Math.ceil(lo); y <= hi; y++) years.push({ v: y, label: String(y) });
  if (years.length >= 3) return years.length > 7 ? years.filter((_, i) => i % 2 === 0) : years;
  const out: SpaceAxis['ticks'] = [];
  for (let q = Math.ceil(lo * 4) / 4; q <= hi; q += 0.25) {
    const y = Math.floor(q + 1e-9);
    out.push({ v: q, label: `${MON[Math.round((q - y) * 12)]} ${String(y).slice(2)}` });
  }
  return out;
}

function niceTicks(lo: number, hi: number, max = 6): number[] {
  const span = hi - lo;
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => span / s <= max) ?? 100;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

const HORIZON_TICKS = [0.1, 1, 10, 60, 480, 2400, 10080, 43200];

export default function CapabilitySpacePanel() {
  const core = useCore();
  const trends = useTrends();
  const t = useTokens();
  const { clearAll } = useChartFilters();
  const { keep, picked, anyPicked } = useModelScope();
  const reduced = useReducedMotion();

  const modelById = useMemo(() => new Map(core.models.map((m) => [m.id, m])), [core.models]);
  const metrLookup = useMemo(() => {
    const byId = new Map<string, number>();
    const byName = new Map<string, number>();
    for (const p of trends.metr) {
      if (p.modelId) byId.set(p.modelId, Math.max(byId.get(p.modelId) ?? 0, p.p50));
      byName.set(norm(p.name), Math.max(byName.get(norm(p.name)) ?? 0, p.p50));
    }
    return { byId, byName };
  }, [trends.metr]);

  // Base points with every candidate z value resolved once. The 3D scene can't dim points, so a
  // model pick limits it in either pick mode.
  const base = useMemo(() => {
    return trends.eci
      .filter((p) => Number.isFinite(p.eci) && keep({ ...p, g: p.labGroup }) && (!anyPicked || picked(p)))
      .map((p, i) => {
        // `flop` is forward-compatible: the pipeline may add Epoch compute estimates to every ECI point.
        const flop = (p as EciPoint & { flop?: number | null }).flop ?? (p.modelId ? modelById.get(p.modelId)?.trainingFlop : null) ?? null;
        const metr = (p.modelId ? metrLookup.byId.get(p.modelId) : undefined) ?? metrLookup.byName.get(norm(p.name)) ?? null;
        return { key: `${p.name}|${p.date}|${i}`, p, flop: flop && flop > 0 ? flop : null, metr: metr && metr > 0 ? metr : null };
      });
  }, [trends.eci, keep, picked, anyPicked, modelById, metrLookup]);

  const counts = useMemo(() => ({ compute: base.filter((b) => b.flop).length, metr: base.filter((b) => b.metr).length, total: base.length }), [base]);
  const [zMode, setZMode] = useState<ZMode | null>(null);
  // Default to compute once there is enough of it to be worth a dimension.
  const mode: ZMode = zMode ?? (counts.compute >= 10 ? 'compute' : 'lanes');
  const [hideUnknown, setHideUnknown] = useState(false);
  const [view, setView] = useState<View>('chart');
  const [autoRotate, setAutoRotate] = useState(true);
  const [resetSignal, setResetSignal] = useState(0);

  const lanes = useMemo(() => ALL_GROUPS.filter((g) => base.some((b) => b.p.labGroup === g)), [base]);

  const { points, xAxis, yAxis, zAxis, zLabel } = useMemo(() => {
    const frontKeys = new Set(
      frontier(
        base,
        (b) => yearFrac(b.p.date),
        (b) => b.p.eci,
      ).map((b) => b.key),
    );
    const zOf = (b: (typeof base)[number]): { z: number | null; zText?: string } => {
      if (mode === 'compute') return b.flop ? { z: Math.log10(b.flop), zText: `${fmtFlop(b.flop)} FLOP` } : { z: null };
      if (mode === 'metr') return b.metr ? { z: Math.log10(b.metr), zText: fmtHorizon(b.metr) } : { z: null };
      return { z: lanes.indexOf(b.p.labGroup), zText: LAB_META[b.p.labGroup].label };
    };
    const pts: SpacePoint[] = base
      .map((b) => ({
        key: b.key,
        name: b.p.name,
        modelId: b.p.modelId,
        g: b.p.labGroup,
        date: b.p.date,
        x: yearFrac(b.p.date),
        eci: b.p.eci,
        eciLo: b.p.low,
        eciHi: b.p.high,
        frontier: frontKeys.has(b.key),
        flopText: b.flop ? `${fmtFlop(b.flop)} FLOP` : undefined,
        ...zOf(b),
      }))
      .filter((p) => !(hideUnknown && p.z == null));

    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.eci);
    const xLo = xs.length ? Math.min(...xs) - 0.08 : 2023;
    const xHi = xs.length ? Math.max(...xs) + 0.08 : 2027;
    const yLo = ys.length ? Math.floor((Math.min(...ys) - 2) / 10) * 10 : 0;
    const yHi = ys.length ? Math.ceil((Math.max(...ys) + 2) / 10) * 10 : 200;

    let z: SpaceAxis;
    let zLabel: string;
    if (mode === 'lanes') {
      z = { domain: [-0.6, Math.max(0.6, lanes.length - 0.4)], ticks: lanes.map((g, i) => ({ v: i, label: `${LAB_META[g].glyph} ${LAB_META[g].label}` })), title: 'Lab lane' };
      zLabel = 'Lab';
    } else {
      const zs = pts.map((p) => p.z).filter((v): v is number => v != null);
      const lo = zs.length ? Math.floor(Math.min(...zs) - 0.15) : mode === 'compute' ? 23 : 0;
      const hi = zs.length ? Math.ceil(Math.max(...zs) + 0.15) : mode === 'compute' ? 27 : 3;
      if (mode === 'compute') {
        const all: number[] = [];
        for (let v = lo; v <= hi; v++) all.push(v);
        const ticks = (all.length > 6 ? all.filter((_, i) => i % 2 === 0) : all).map((v) => ({ v, label: `1e${v}` }));
        z = { domain: [lo, hi], ticks, title: 'Training FLOP (log)' };
        zLabel = 'Training compute';
      } else {
        const ticks = HORIZON_TICKS.map((m) => Math.log10(m))
          .filter((v) => v >= lo && v <= hi)
          .map((v) => ({ v, label: fmtHorizon(10 ** v) }));
        z = { domain: [lo, hi], ticks, title: 'METR 50% horizon (log)' };
        zLabel = 'METR 50% horizon';
      }
    }
    return {
      points: pts,
      xAxis: { domain: [xLo, xHi] as [number, number], ticks: timeTicks(xLo, xHi), title: 'Release date' },
      yAxis: { domain: [yLo, yHi] as [number, number], ticks: niceTicks(yLo, yHi).map((v) => ({ v, label: String(v) })), title: 'ECI' },
      zAxis: z,
      zLabel,
    };
  }, [base, mode, lanes, hideUnknown]);

  // Mount the WebGL scene only once it nears the viewport; render only while visible.
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ioNear = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: '300px' });
    const ioVis = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 });
    ioNear.observe(el);
    ioVis.observe(el);
    return () => {
      ioNear.disconnect();
      ioVis.disconnect();
    };
  }, [view, points.length > 0]);

  const known = mode === 'compute' ? counts.compute : mode === 'metr' ? counts.metr : counts.total;
  const tableRows = useMemo(() => [...points].sort((a, b) => b.eci - a.eci), [points]);

  return (
    <Panel
      kicker="Capability space · 3D"
      title={`Release date × ECI × ${mode === 'compute' ? 'training compute' : mode === 'metr' ? 'METR horizon' : 'lab'}`}
      actions={
        <>
          <Segmented<ZMode>
            label="Depth axis"
            value={mode}
            onChange={setZMode}
            options={[
              { value: 'compute', label: 'log compute', title: `${counts.compute} of ${counts.total} models have a training-compute estimate` },
              { value: 'metr', label: 'METR horizon', title: `${counts.metr} of ${counts.total} models have a METR horizon` },
              { value: 'lanes', label: 'lab lanes', title: 'One depth lane per lab group' },
            ]}
          />
          <ViewToggle value={view} onChange={setView} chartLabel="3D" />
        </>
      }
      footer={
        <>
          Every model Epoch rates on ECI{anyPicked ? ' (limited to the picked models)' : ''}. The glowing line joins the ECI frontier (best so far).{' '}
          {mode !== 'lanes' && (
            <>
              {mode === 'compute' ? 'Training-compute' : 'METR'} values known for {known} of {counts.total} models; the rest are parked faintly on the back plane (or hidden).{' '}
            </>
          )}
          Compute: registry estimates (Epoch). Drag to orbit, click once to enable scroll-zoom, hover for values.
        </>
      }
    >
      {!points.length ? (
        <EmptyState title="No models in this filter">
          Widen the lab, release-date, model or weights filters.
          <div>
            <ClearFiltersButton onClick={clearAll} />
          </div>
        </EmptyState>
      ) : view === 'table' ? (
        <DataTable
          caption="Models in the capability space"
          rows={tableRows}
          rowKey={(r) => r.key}
          columns={[
            { key: 'n', label: 'Model', sort: (r) => r.name, render: (r) => (r.modelId ? <button className="text-left text-ink underline decoration-line-2 underline-offset-2 hover:decoration-accent" onClick={() => openModel(r.modelId!)}>{r.name}</button> : <span className="text-ink">{r.name}</span>) },
            { key: 'g', label: 'Lab', sort: (r) => LAB_META[r.g].label, render: (r) => <LabCell g={r.g} /> },
            { key: 'd', label: 'Released', sort: (r) => r.x, text: (r) => monthYear(r.date), render: (r) => monthYear(r.date) },
            { key: 'e', label: 'ECI', align: 'right', sort: (r) => r.eci, render: (r) => r.eci.toFixed(1) },
            { key: 'z', label: zLabel, align: 'right', sort: (r) => r.z, render: (r) => r.zText ?? '—' },
            { key: 'f', label: 'Frontier', sort: (r) => (r.frontier ? 1 : 0), render: (r) => (r.frontier ? '★' : '') },
          ]}
        />
      ) : (
        <>
          <div ref={box} className="relative h-[420px] overflow-hidden rounded-2xl border border-line sm:h-[540px]" style={{ background: t.theme === 'dark' ? t.bg : t.surface2 }}>
            {near && (
              <ErrorBoundary label="3D view">
                <Suspense fallback={<Skeleton h={540} className="absolute inset-0 !h-full !rounded-none !border-0" />}>
                  <CapabilitySpace
                    points={points}
                    xAxis={xAxis}
                    yAxis={yAxis}
                    zAxis={zAxis}
                    zLabel={zLabel}
                    tokens={t}
                    active={visible}
                    reducedMotion={reduced}
                    autoRotate={autoRotate}
                    resetSignal={resetSignal}
                  />
                </Suspense>
              </ErrorBoundary>
            )}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-2 p-3">
              <div className="pointer-events-auto flex flex-wrap gap-1.5">
                {mode !== 'lanes' && (
                  <Chip active={!hideUnknown} onClick={() => setHideUnknown((v) => !v)} title="Show models without a value for the depth axis, parked on the back plane">
                    unknown {mode === 'compute' ? 'compute' : 'horizon'} ({counts.total - known})
                  </Chip>
                )}
              </div>
              <div className="pointer-events-auto flex gap-1.5">
                {!reduced && (
                  <button onClick={() => setAutoRotate((v) => !v)} className="rounded-full border border-line-2 bg-surface-2/80 px-2.5 py-1 font-mono text-[11px] text-ink-2 backdrop-blur hover:text-ink" aria-pressed={autoRotate}>
                    {autoRotate ? '❚❚ pause' : '▶ rotate'}
                  </button>
                )}
                <button onClick={() => setResetSignal((n) => n + 1)} className="rounded-full border border-line-2 bg-surface-2/80 px-2.5 py-1 font-mono text-[11px] text-ink-2 backdrop-blur hover:text-ink">
                  ⟲ reset view
                </button>
              </div>
            </div>
            <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full border border-line bg-surface-2/70 px-2.5 py-1 font-mono text-[10.5px] text-ink-3 backdrop-blur">
              drag · orbit &nbsp;|&nbsp; click, then scroll · zoom
            </div>
          </div>
          <div className="mt-3">
            <Legend
              items={[
                ...lanes.map((g: LabGroup) => ({ label: `${LAB_META[g].label} (${['sphere', 'octahedron', 'tetrahedron', 'cube', 'dodecahedron', 'small icosahedron'][ALL_GROUPS.indexOf(g)]})`, color: labVar(g), glyph: LAB_META[g].glyph })),
                { label: 'ECI frontier', color: 'var(--accent)', glyph: '━' },
              ]}
            />
          </div>
        </>
      )}
    </Panel>
  );
}
