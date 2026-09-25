import { MotionConfig, motion } from 'motion/react';
import { Suspense, useMemo, type ReactNode } from 'react';
import { ErrorBoundary, Skeleton, Stat } from '../components/ui/misc.tsx';
import { useTrends } from '../lib/data.ts';
import { fitPoints, frontier } from '../lib/fit.ts';
import { monthYear, yearFrac } from '../lib/format.ts';
import BreakthroughsPanel from './charts/BreakthroughsPanel.tsx';
import CapabilityChart from './charts/CapabilityChart.tsx';
import CapabilitySpacePanel from './charts/CapabilitySpacePanel.tsx';
import { fmtHorizon } from './charts/common.tsx';
import CostPanel from './charts/CostPanel.tsx';
import EffortPanel from './charts/EffortPanel.tsx';
import { optionRef } from './charts/filterModel.ts';
import { ChartFiltersProvider, FilterBar, useModelScope } from './charts/filters.tsx';
import LevPanel from './charts/LevPanel.tsx';
import ProjectionPanel from './charts/ProjectionPanel.tsx';
import SpendingPanel from './charts/SpendingPanel.tsx';

/** One grid cell: isolated failures, its own suspense, and a short entrance. */
function Module({ span, label, h = 420, children }: { span: string; label: string; h?: number; children: ReactNode }) {
  return (
    <motion.div className={`min-w-0 ${span}`} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '0px 0px -40px 0px' }} transition={{ duration: 0.28, ease: 'easeOut' }}>
      <ErrorBoundary label={label}>
        <Suspense fallback={<Skeleton h={h} />}>{children}</Suspense>
      </ErrorBoundary>
    </motion.div>
  );
}

/** Headline numbers for the current filters. */
function HeroStats() {
  const trends = useTrends();
  const { keep, idx } = useModelScope();
  const s = useMemo(() => {
    const eci = trends.eci.filter((p) => keep({ ...p, g: p.labGroup }));
    const metr = trends.metr.filter((p) => keep({ ...p, g: p.labGroup }));
    const eciTop = frontier(eci, (p) => yearFrac(p.date), (p) => p.eci).at(-1);
    const metrFront = frontier(metr, (p) => yearFrac(p.date), (p) => p.p50);
    const recent = metrFront.filter((p) => p.date >= '2024-01-01').map((p) => ({ x: yearFrac(p.date), y: p.p50 }));
    const fit = fitPoints(recent, 'exponential');
    return {
      eciTop,
      metrTop: metrFront.at(-1),
      doubling: fit && fit.kind === 'exponential' && fit.rate > 0 ? fit.doublingTime * 12 : null,
      recentN: recent.length,
      models: idx.options.filter((o) => keep(optionRef(o))).length,
    };
  }, [trends, keep, idx]);
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
      <Stat label="ECI frontier" value={s.eciTop ? s.eciTop.eci.toFixed(1) : '—'} sub={s.eciTop ? `${s.eciTop.name} · ${monthYear(s.eciTop.date)}` : 'no models in filter'} />
      <Stat label="METR 50% horizon" value={s.metrTop ? fmtHorizon(s.metrTop.p50) : '—'} sub={s.metrTop ? `${s.metrTop.name} · ${monthYear(s.metrTop.date)}` : 'no models in filter'} />
      <Stat label="Horizon doubling" value={s.doubling ? `${s.doubling.toFixed(1)} mo` : '—'} sub={s.doubling ? `exp. fit, ${s.recentN} frontier pts since 2024` : 'needs ≥ 3 frontier pts since 2024'} />
      <Stat label="Models in view" value={s.models} sub="registry, Epoch and METR models in the filters" />
    </div>
  );
}

export default function ChartsTab() {
  return (
    <MotionConfig reducedMotion="user">
      <ChartFiltersProvider>
        <div className="space-y-5">
          <header className="space-y-5 pt-2">
            <div>
              <div className="kicker mb-2">Charts lab</div>
              <h1 className="text-[30px] font-semibold leading-[1.05] tracking-tight text-ink sm:text-[40px]">
                Where the <span className="text-aurora">curves</span> are going
              </h1>
              <p className="mt-2 max-w-2xl text-[14px] text-ink-2">Capability, horizon, cost and effort trends from Epoch and METR data, with fits you can pull on. Every projection shows its uncertainty.</p>
            </div>
            <Suspense fallback={<Skeleton h={64} />}>
              <HeroStats />
            </Suspense>
          </header>

          <Suspense fallback={<Skeleton h={56} />}>
            <FilterBar />
          </Suspense>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <Module span="lg:col-span-12" label="Capability over time" h={560}>
              <CapabilityChart />
            </Module>
            <Module span="lg:col-span-12" label="Capability space" h={640}>
              <CapabilitySpacePanel />
            </Module>
            <Module span="lg:col-span-6" label="Cost to capability" h={620}>
              <CostPanel />
            </Module>
            <Module span="lg:col-span-6" label="Effort vs tokens" h={620}>
              <EffortPanel />
            </Module>
            <Module span="lg:col-span-12" label="Projection workbench" h={680}>
              <ProjectionPanel />
            </Module>
            <Module span="lg:col-span-6" label="Spending">
              <SpendingPanel />
            </Module>
            <Module span="lg:col-span-6" label="Longevity escape velocity">
              <LevPanel />
            </Module>
            <Module span="lg:col-span-12" label="Breakthroughs">
              <BreakthroughsPanel />
            </Module>
          </div>
        </div>
      </ChartFiltersProvider>
    </MotionConfig>
  );
}
