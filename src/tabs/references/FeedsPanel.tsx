import { Panel } from '../../components/ui/Panel.tsx';
import { InfoTip } from '../../components/ui/misc.tsx';
import { hostOf } from '../../lib/filters.ts';
import { setTab } from '../../lib/ui-state.ts';
import { SECTION_TAB, type Feed } from './types.ts';
import { displayUrl, Ext, fmtDay, Monogram } from './ui.tsx';

/** One card per live provider: what each endpoint feeds, its licence, and when it was last pulled. */
export function FeedsPanel({ feeds }: { feeds: Feed[] }) {
  const endpoints = feeds.reduce((n, f) => n + f.endpoints.length, 0);
  return (
    <Panel
      kicker={
        <span className="inline-flex items-center gap-2">
          <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          Live data feeds
        </span>
      }
      title={
        <span className="inline-flex items-center gap-2">
          {endpoints} endpoints, re-fetched on every refresh
          <InfoTip align="left">
            <code className="font-mono">npm run refresh</code> pulls these URLs (scripts/fetch/*.ts), keeps the last good copy if one fails, and writes a dated snapshot to
            data/snapshots/. Everything else on this page is hand-curated in data/curated/*.yaml.
          </InfoTip>
        </span>
      }
    >
      {feeds.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-ink-3">No live feeds found. Check scripts/fetch/*.ts and run `npm run build:refs`.</p>
      ) : (
        // Masonry via CSS columns: cards differ a lot in height (1 endpoint vs 4).
        <div className="gap-4 md:columns-2 [&>article]:mb-4 [&>article]:break-inside-avoid [&>article:last-child]:mb-0">
          {feeds.map((f) => (
            <FeedCard key={f.id} f={f} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function FeedCard({ f }: { f: Feed }) {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface-2/50 p-4">
      <header className="flex items-start gap-3">
        <Monogram host={hostOf(f.homepage)} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="kicker mb-0.5 truncate">{f.org}</div>
          <h3 className="text-[14.5px] font-semibold leading-snug tracking-tight text-ink">
            <Ext href={f.homepage} className="decoration-transparent">
              {f.name}
            </Ext>
          </h3>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {f.licenseUrl ? (
          <a href={f.licenseUrl} target="_blank" rel="noreferrer noopener" className="rounded-full border border-line-2 px-2 py-0.5 text-ink hover:border-[var(--text-3)]">
            § {f.license}
          </a>
        ) : (
          <span className="rounded-full border border-line-2 px-2 py-0.5 text-ink">§ {f.license}</span>
        )}
        <span className="rounded-full border border-line px-2 py-0.5 text-ink-2">fetched {fmtDay(f.lastFetched)}</span>
        <span className="min-w-0 truncate rounded-full border border-line px-2 py-0.5 font-mono text-ink-3">{f.fetcher}</span>
      </div>

      <ul className="space-y-3">
        {f.endpoints.map((e) => (
          <li key={e.url} className="min-w-0 rounded-xl border border-line bg-surface/60 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-[13px] font-medium text-ink">{e.label}</span>
              <span className="font-mono text-[10.5px] text-ink-3">{e.format}</span>
            </div>
            <a href={e.url} target="_blank" rel="noreferrer noopener" className="mt-1 block break-all font-mono text-[11px] leading-snug text-ink-3 hover:text-ink">
              {displayUrl(e.url)} ↗
            </a>
            <ul className="mt-2 space-y-1">
              {e.powers.map((p, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[12px] leading-snug text-ink-2">
                  <button
                    type="button"
                    onClick={() => setTab(SECTION_TAB[p.section])}
                    title={`Open ${p.section}`}
                    className="shrink-0 rounded-full border border-line px-1.5 font-mono text-[10px] text-ink-3 hover:border-line-2 hover:text-ink"
                  >
                    {p.section}
                  </button>
                  <span className="min-w-0">{p.what}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {f.note && <p className="text-[11.5px] leading-relaxed text-ink-3">{f.note}</p>}
    </article>
  );
}
