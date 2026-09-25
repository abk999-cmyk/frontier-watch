import { AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense } from 'react';
import { Header } from './components/Header.tsx';
import { ModelDrawer } from './components/ModelDrawer.tsx';
import { ErrorBoundary, TabSkeleton } from './components/ui/misc.tsx';
import { useTab, type TabId } from './lib/ui-state.ts';

const SpaceBackground = lazy(() => import('./components/three/SpaceBackground.tsx').then((m) => ({ default: m.SpaceBackground })));
const AlanTab = lazy(() => import('./tabs/AlanTab.tsx'));
const BenchmarksTab = lazy(() => import('./tabs/BenchmarksTab.tsx'));
const ChartsTab = lazy(() => import('./tabs/ChartsTab.tsx'));
const TimelinesTab = lazy(() => import('./tabs/TimelinesTab.tsx'));
const ReferencesTab = lazy(() => import('./tabs/ReferencesTab.tsx'));

const VIEWS: Record<TabId, React.LazyExoticComponent<() => React.JSX.Element>> = {
  alan: AlanTab,
  benchmarks: BenchmarksTab,
  charts: ChartsTab,
  timelines: TimelinesTab,
  references: ReferencesTab,
};

export default function App() {
  const tab = useTab();
  const View = VIEWS[tab];
  return (
    <>
      <Suspense fallback={null}>
        <SpaceBackground />
      </Suspense>
      <Header />
      <main className="mx-auto max-w-[1520px] px-4 pb-24 pt-6 sm:px-6">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none', transform: 'none' } }} exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }} transition={{ duration: 0.28, ease: 'easeOut' }}>
            <ErrorBoundary label="Tab">
              <Suspense fallback={<TabSkeleton />}>
                <View />
              </Suspense>
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </main>
      <Footer />
      <Suspense fallback={null}>
        <ModelDrawer />
      </Suspense>
    </>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line py-8 text-[11.5px] text-ink-3">
      <div className="mx-auto flex max-w-[1520px] flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
        <span>
          Data: <a className="underline decoration-line-2 underline-offset-2 hover:text-ink" href="https://epoch.ai/benchmarks" target="_blank" rel="noreferrer">Epoch AI</a> (CC-BY) ·{' '}
          <a className="underline decoration-line-2 underline-offset-2 hover:text-ink" href="https://lifearchitect.ai/agi/" target="_blank" rel="noreferrer">Dr Alan D. Thompson, LifeArchitect.ai</a> ·{' '}
          <a className="underline decoration-line-2 underline-offset-2 hover:text-ink" href="https://ai-2027.com" target="_blank" rel="noreferrer">AI Futures Project</a> · lab model cards ·{' '}
          <a className="underline decoration-line-2 underline-offset-2 hover:text-ink" href="#references">all references →</a>
        </span>
        <span className="font-mono">keys 1–4 switch tabs · Esc closes panels</span>
      </div>
    </footer>
  );
}
