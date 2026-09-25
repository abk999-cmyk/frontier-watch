import type { ReactNode } from 'react';
import { Panel } from '../../components/ui/Panel.tsx';
import { KIND_META, KINDS, SECTION_HINT, SECTIONS, type Kind, type RefsStats, type Section } from './types.ts';
import { Monogram } from './ui.tsx';

interface Props {
  stats: RefsStats;
  kinds: Kind[];
  sections: Section[];
  hosts: string[];
  onKind: (k: Kind) => void;
  onSection: (s: Section) => void;
  onHost: (h: string) => void;
}

/** At-a-glance mix of the whole index. Every bar is a button that toggles the matching list filter. */
export function Composition({ stats, kinds, sections, hosts, onKind, onSection, onHost }: Props) {
  const kindRows = KINDS.map((k) => ({ k, n: stats.byKind[k] ?? 0 }))
    .filter((r) => r.n)
    .sort((a, b) => b.n - a.n);
  const kMax = Math.max(1, ...kindRows.map((r) => r.n));
  const sMax = Math.max(1, ...SECTIONS.map((s) => stats.bySection[s] ?? 0));
  const top = stats.byHost.slice(0, 10);
  const hMax = Math.max(1, ...top.map((h) => h.refs));
  return (
    <Panel
      kicker="Source mix"
      title="What kind of sources, feeding which part of the dashboard"
      footer="Counts are unique URLs. A source used by two tabs counts once in each section bar. Click any bar to filter the list below."
    >
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
        <Block title="By kind">
          {kindRows.map(({ k, n }) => (
            <Bar key={k} active={kinds.includes(k)} value={n} max={kMax} onClick={() => onKind(k)} title={KIND_META[k].hint}>
              <span className="w-3 shrink-0 text-center text-[10px] text-ink-3">{KIND_META[k].glyph}</span>
              {KIND_META[k].label}
            </Bar>
          ))}
        </Block>
        <Block title="By dashboard section">
          {SECTIONS.map((s) => (
            <Bar key={s} active={sections.includes(s)} value={stats.bySection[s] ?? 0} max={sMax} onClick={() => onSection(s)} title={SECTION_HINT[s]} sub={SECTION_HINT[s]}>
              {s}
            </Bar>
          ))}
        </Block>
        <Block title="Top domains">
          {top.map((h) => (
            <Bar key={h.host} active={hosts.includes(h.host)} value={h.refs} max={hMax} onClick={() => onHost(h.host)} title={`${h.refs} URLs · ${h.count.toLocaleString()} citations`}>
              <Monogram host={h.host} size="sm" />
              <span className="min-w-0 truncate">{h.host}</span>
            </Bar>
          ))}
        </Block>
      </div>
    </Panel>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="kicker mb-2">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Bar({ active, value, max, onClick, title, sub, children }: { active: boolean; value: number; max: number; onClick: () => void; title?: string; sub?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={`group block w-full rounded-lg px-2 py-1.5 text-left transition-colors ${active ? 'bg-[var(--accent-soft)]' : 'hover:bg-surface-2/70'}`}
    >
      <span className="flex items-center gap-2 text-[12.5px]">
        <span className={`flex min-w-0 flex-1 items-center gap-1.5 ${active ? 'text-ink' : 'text-ink-2 group-hover:text-ink'}`}>{children}</span>
        <span className="shrink-0 font-mono text-[11.5px] text-ink tnum">{value.toLocaleString()}</span>
      </span>
      {sub && <span className="block truncate text-[11px] text-ink-3">{sub}</span>}
      <span className="mt-1 block h-1 w-full rounded-full bg-surface-3">
        <span className={`block h-1 rounded-full transition-[width] duration-300 ${active ? 'bg-accent' : 'bg-[var(--text-3)] opacity-60 group-hover:opacity-90'}`} style={{ width: `${Math.max(2, (value / max) * 100)}%` }} />
      </span>
    </button>
  );
}
