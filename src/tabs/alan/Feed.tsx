import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { Suspense, useState, type ReactNode } from 'react';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { ErrorBoundary, Skeleton } from '../../components/ui/misc.tsx';
import { Discoveries } from './Discoveries.tsx';
import { EvidenceLog } from './EvidenceLog.tsx';

type View = 'log' | 'discoveries';

const COPY: Record<View, { kicker: string; title: ReactNode; lede: string }> = {
  log: {
    kicker: "Evidence log · Alan's AGI countdown + ASI checklist",
    title: (
      <>
        What <span className="text-aurora">moved the needle</span>
      </>
    ),
    lede: "Every entry from Alan's countdown log and his ASI evidence log, in one stream. Filter by date, lab, indicator or source, and isolate the entries where the gauge actually rose or an indicator changed status.",
  },
  discoveries: {
    kicker: "AI discoveries · curated list + Alan's table",
    title: (
      <>
        What AI has <span className="text-aurora">discovered</span>
      </>
    ),
    lede: 'Math and science results where AI was central to the discovery, graded for significance, verification and autonomy, and merged with the discoveries Alan tracks on his ASI page.',
  },
};

/**
 * The Countdown tab's evidence section. Unboxed: it sits on the page background with a
 * section heading, then either the merged evidence log or the AI discoveries view.
 * Discoveries mounts on first open (it loads charts.json) and then stays mounted, so
 * each view keeps its filters when you switch back and forth.
 */
export function Feed() {
  const [view, setView] = useState<View>('log');
  const [seen, setSeen] = useState<Record<View, boolean>>({ log: true, discoveries: false });
  const c = COPY[view];
  const go = (v: View) => {
    setView(v);
    setSeen((s) => (s[v] ? s : { ...s, [v]: true }));
  };

  return (
    <MotionConfig reducedMotion="user">
      <section id="evidence" aria-labelledby="evidence-title" className="relative pt-14 sm:pt-16">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--line-2)_18%,var(--line-2)_82%,transparent)]" />
        <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0 max-w-3xl">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={view} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
                <div className="kicker mb-3">{c.kicker}</div>
                <h2 id="evidence-title" className="text-[30px] font-semibold leading-[1.05] tracking-tight sm:text-[40px]">
                  {c.title}
                </h2>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{c.lede}</p>
              </motion.div>
            </AnimatePresence>
          </div>
          <Segmented
            size="md"
            label="Evidence view"
            value={view}
            onChange={go}
            options={[
              { value: 'log', label: 'Evidence log' },
              { value: 'discoveries', label: 'AI discoveries' },
            ]}
          />
        </header>

        <div className="mt-8">
          <div hidden={view !== 'log'}>
            <EvidenceLog />
          </div>
          {seen.discoveries && (
            <div hidden={view !== 'discoveries'}>
              <ErrorBoundary label="AI discoveries">
                <Suspense fallback={<Skeleton h={520} />}>
                  <Discoveries />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
        </div>
      </section>
    </MotionConfig>
  );
}
