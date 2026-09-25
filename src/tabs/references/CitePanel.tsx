import { Panel } from '../../components/ui/Panel.tsx';
import type { Citation } from './types.ts';
import { CopyButton, Ext } from './ui.tsx';

/** Attribution text for every upstream whose data this dashboard republishes. */
export function CitePanel({ citations, generatedAt }: { citations: Citation[]; generatedAt: string }) {
  const all = [
    `Frontier Watch (personal AI-progress dashboard), data compiled ${generatedAt.slice(0, 10)} from:`,
    ...citations.map((c) => `- ${c.text}`),
  ].join('\n');
  return (
    <Panel
      kicker="Cite this dashboard’s data"
      title="Attribution for the datasets republished here"
      actions={<CopyButton text={all} label="Copy all" />}
      footer="Model cards, papers, filings and news are linked rather than copied; follow each link above for its own terms. Scores from labs are labelled lab-reported everywhere they appear."
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {citations.map((c) => (
          <figure key={c.id} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-surface-2/50 p-4">
            <figcaption className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-semibold tracking-tight text-ink">{c.source}</span>
              <span className="rounded-full border border-line-2 px-2 py-px text-[10.5px] text-ink-2">§ {c.license}</span>
              <CopyButton text={c.text} className="ml-auto" />
            </figcaption>
            <blockquote className="select-all break-words rounded-xl border border-line bg-surface/70 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink-2">{c.text}</blockquote>
            <Ext href={c.url} className="self-start break-all text-[11.5px] text-ink-3">
              {c.url.replace(/^https?:\/\//, '')} ↗
            </Ext>
          </figure>
        ))}
      </div>
    </Panel>
  );
}
