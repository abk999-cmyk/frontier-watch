import { useEffect, useMemo, useState } from 'react';
import { ErrorBoundary, Stat } from '../components/ui/misc.tsx';
import { CitePanel } from './references/CitePanel.tsx';
import { Composition } from './references/Composition.tsx';
import { FeedsPanel } from './references/FeedsPanel.tsx';
import { fromQuery, prepare, toQuery, type RefFilter } from './references/filter.ts';
import { RefList } from './references/RefList.tsx';
import { fmtDay, useRefs } from './references/ui.tsx';

/** Filters survive reloads and can be linked to: #references?host=arxiv.org&kind=paper */
const readHashQuery = () => (typeof location === 'undefined' ? '' : (location.hash.split('?')[1] ?? ''));

export default function ReferencesTab() {
  const data = useRefs();
  const items = useMemo(() => prepare(data.refs ?? []), [data.refs]);
  const [filter, setFilter] = useState<RefFilter>(() => fromQuery(readHashQuery()));

  useEffect(() => {
    if (!location.hash.startsWith('#references')) return;
    const qs = toQuery(filter);
    const next = `#references${qs ? `?${qs}` : ''}`;
    if (location.hash !== next) history.replaceState(history.state, '', next);
  }, [filter]);

  const s = data.stats;
  const endpoints = data.feeds.reduce((n, f) => n + f.endpoints.length, 0);
  const latestFetch = data.feeds.map((f) => f.lastFetched ?? '').sort().at(-1);
  const rows = s.scoreRows.independent + s.scoreRows.lab;
  const indepPct = rows ? Math.round((s.scoreRows.independent / rows) * 100) : 0;

  const toggle = <K extends 'kinds' | 'sections' | 'hosts'>(k: K, v: RefFilter[K][number]) => {
    setFilter((f) => {
      const cur = f[k] as string[];
      return { ...f, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
    });
    document.getElementById('ref-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-1 items-end gap-6 pt-2 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div className="kicker mb-3">References · index built {fmtDay(data.generatedAt)}</div>
          <h1 className="text-[32px] font-semibold leading-[1.05] tracking-tight text-ink sm:text-[44px]">
            Where <span className="text-aurora">every number</span> comes from
          </h1>
          <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-ink-2">
            Independent measurements (Epoch AI’s Benchmarking Hub, METR, public leaderboards) are kept apart from lab-reported numbers from model cards and launch posts,
            and every score says which it is. Four live feeds are re-fetched on each refresh; everything else is hand-curated in YAML with a primary source per fact. Epoch
            and Our World in Data are CC BY 4.0, LifeArchitect.ai is used with citation, and everything else is linked, never copied.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:col-span-5">
          <Stat label="Unique sources" value={s.total.toLocaleString()} sub={`${s.citations.toLocaleString()} citations`} />
          <Stat label="Domains" value={s.hosts.toLocaleString()} sub={s.byHost.slice(0, 3).map((h) => h.host).join(' · ')} />
          <Stat label="Live endpoints" value={endpoints} sub={`${data.feeds.length} feeds · ${fmtDay(latestFetch)}`} />
          <Stat label="Curated" value={(s.byOrigin.curated + s.byOrigin.both).toLocaleString()} sub="URLs in data/curated" />
          <Stat label="Fetched" value={(s.byOrigin.fetched + s.byOrigin.both).toLocaleString()} sub={`${s.byOrigin.both} also curated`} />
          <Stat label="Independent" value={`${indepPct}%`} sub={`${s.scoreRows.independent.toLocaleString()} of ${rows.toLocaleString()} score rows`} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-12">
          <ErrorBoundary label="Live data feeds">
            <FeedsPanel feeds={data.feeds} />
          </ErrorBoundary>
        </div>
        <div className="min-w-0 lg:col-span-12">
          <ErrorBoundary label="Source mix">
            <Composition
              stats={s}
              kinds={filter.kinds}
              sections={filter.sections}
              hosts={filter.hosts}
              onKind={(k) => toggle('kinds', k)}
              onSection={(x) => toggle('sections', x)}
              onHost={(h) => toggle('hosts', h)}
            />
          </ErrorBoundary>
        </div>
        <div className="min-w-0 lg:col-span-12">
          <ErrorBoundary label="Reference list">
            <RefList items={items} filter={filter} setFilter={setFilter} />
          </ErrorBoundary>
        </div>
        <div className="min-w-0 lg:col-span-12">
          <ErrorBoundary label="Citations">
            <CitePanel citations={data.citations} generatedAt={data.generatedAt} />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
