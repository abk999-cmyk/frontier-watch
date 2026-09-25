import { useMemo } from 'react';
import { Panel } from '../components/ui/Panel.tsx';
import { ErrorBoundary } from '../components/ui/misc.tsx';
import { useTimelines } from '../lib/data.ts';
import { monthYear } from '../lib/format.ts';
import { Ai2040Panel } from './timelines/Ai2040Panel.tsx';
import { DriftPanel } from './timelines/DriftPanel.tsx';
import { summarizeLag } from './timelines/lag.ts';
import { LagMeter } from './timelines/LagMeter.tsx';
import { ProxyTable } from './timelines/ProxyTable.tsx';
import { TrackPanel } from './timelines/TrackPanel.tsx';
import { normalizeTimelines } from './timelines/types.ts';
import { usePaletteVars } from './timelines/ui.tsx';

export default function TimelinesTab() {
  const raw = useTimelines();
  const data = useMemo(() => normalizeTimelines(raw), [raw]);
  const now = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const summary = useMemo(() => summarizeLag(data.proxies, now), [data.proxies, now]);
  const vars = usePaletteVars();
  const milestones = data.ai2027?.milestones ?? [];

  return (
    <div className="space-y-5" style={vars}>
      <header className="pt-2">
        <div className="kicker mb-2">Timelines</div>
        <h1 className="text-[30px] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[40px]">
          Are we on the <span className="text-aurora">AI 2027</span> track?
        </h1>
        <p className="mt-2 max-w-[760px] text-[14.5px] leading-relaxed text-ink-2">
          AI 2027 {data.ai2027?.published ? `(${monthYear(data.ai2027.published)})` : ''} is a month-by-month forecast scenario. Here every milestone is graded against what has actually happened, and measurable proxies turn
          “how close are we?” into a lag in months.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <ErrorBoundary label="Lag meter">
          <Panel className="lg:col-span-12" kicker="Lag meter · reality vs AI 2027" title="How far behind (or ahead of) the scenario reality is running">
            <LagMeter summary={summary} proxies={data.proxies} milestones={milestones} updates={data.updates} now={now} />
          </Panel>
        </ErrorBoundary>

        <div className="lg:col-span-12">
          <ErrorBoundary label="AI 2027 track">
            <TrackPanel ai2027={data.ai2027} proxies={data.proxies} summary={summary} now={now} />
          </ErrorBoundary>
        </div>

        <div className="lg:col-span-12">
          <ErrorBoundary label="Forecast drift">
            <DriftPanel updates={data.updates} now={now} />
          </ErrorBoundary>
        </div>

        <div className="lg:col-span-12">
          <ErrorBoundary label="Proxy ledger">
            <ProxyTable proxies={data.proxies} summary={summary} />
          </ErrorBoundary>
        </div>

        <div className="lg:col-span-12">
          <ErrorBoundary label="AI 2040">
            <Ai2040Panel data={data.ai2040} />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
