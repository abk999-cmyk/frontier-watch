import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react';
import { ActiveFilters, MultiSelect, RangeFilter, SearchInput, SingleSelect, type ActivePill, type Option } from '../../components/filters/Filters.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { isRangeActive } from '../../lib/filters.ts';
import { setTab } from '../../lib/ui-state.ts';
import { applyFilter, EMPTY_FILTER, facet, groupItems, isFilterActive, pageGroups, sortItems, usesCap, type GroupKey, type Item, type RefFilter, type SortKey } from './filter.ts';
import { KIND_META, KINDS, SECTION_HINT, SECTION_TAB, SECTIONS, type Origin, type Section } from './types.ts';
import { displayUrl, Hi, KindBadge, Monogram } from './ui.tsx';

const PAGE = 60;
/** Rows shown per group before its own "show all" (domains are many and small; sections are few and large). */
const PER_GROUP: Record<GroupKey, number> = { host: 8, section: 15, none: Infinity };
const NO_GROUPS: ReadonlySet<string> = new Set();
interface Paging {
  sig: string;
  n: number;
  groups: ReadonlySet<string>;
}
const SORTS: { value: SortKey; label: string; hint?: string }[] = [
  { value: 'used', label: 'Most used', hint: 'citations' },
  { value: 'az', label: 'Title A–Z' },
  { value: 'host', label: 'Domain A–Z' },
];
const ORIGIN_LABEL: Record<Origin, string> = { curated: 'Curated (data/curated)', fetched: 'Fetched (live feeds)' };
const fileGroup = (f: string) => (f.endsWith('.ts') ? 'Fetchers' : f.endsWith('.json') ? 'Fetched bundles' : 'Curated YAML');

interface Props {
  items: Item[];
  filter: RefFilter;
  setFilter: (f: RefFilter | ((f: RefFilter) => RefFilter)) => void;
}

export function RefList({ items, filter, setFilter }: Props) {
  const [sort, setSort] = useState<SortKey>('used');
  const [group, setGroup] = useState<GroupKey>('host');
  const f = useDeferredValue(filter);
  const stale = f !== filter;

  const filtered = useMemo(() => applyFilter(items, f), [items, f]);
  const groups = useMemo(() => groupItems(sortItems(filtered, sort), group, sort, f.sections), [filtered, sort, group, f.sections]);

  // Paging (row budget + individually expanded groups) resets whenever the query changes:
  // keyed by a signature of the query instead of a reset effect.
  const sig = JSON.stringify([f, sort, group]);
  const [lim, setLim] = useState<Paging>({ sig, n: PAGE, groups: NO_GROUPS });
  const cur = lim.sig === sig ? lim : { sig, n: PAGE, groups: NO_GROUPS };
  const page = useMemo(() => pageGroups(groups, cur.n, PER_GROUP[group], cur.groups), [groups, cur.n, cur.groups, group]);

  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggleOpen = useCallback(
    (url: string) =>
      setOpen((s) => {
        const n = new Set(s);
        if (n.has(url)) n.delete(url);
        else n.add(url);
        return n;
      }),
    [],
  );

  // ── facet options (other filters applied) ──
  const cap = useMemo(() => usesCap(items), [items]);
  const opts = useMemo(() => {
    const sec = facet(items, f, 'sections');
    const kin = facet(items, f, 'kinds');
    const hos = facet(items, f, 'hosts');
    const fil = facet(items, f, 'files');
    const ori = facet(items, f, 'origins');
    const allFiles = [...new Set(items.flatMap((i) => i.files))];
    const order = ['Curated YAML', 'Fetched bundles', 'Fetchers'];
    return {
      sections: SECTIONS.map((s): Option => ({ value: s, label: s, count: sec.get(s) ?? 0 })),
      kinds: KINDS.map((k): Option => ({ value: k, label: KIND_META[k].label, glyph: KIND_META[k].glyph, color: 'var(--text-3)', count: kin.get(k) ?? 0 })),
      hosts: [...new Set([...hos.keys(), ...f.hosts])]
        .sort((a, b) => (hos.get(b) ?? 0) - (hos.get(a) ?? 0) || a.localeCompare(b))
        .map((h): Option => ({ value: h, label: h, count: hos.get(h) ?? 0 })),
      files: allFiles
        .sort((a, b) => order.indexOf(fileGroup(a)) - order.indexOf(fileGroup(b)) || (fil.get(b) ?? 0) - (fil.get(a) ?? 0) || a.localeCompare(b))
        .map((x): Option => ({ value: x, label: x, count: fil.get(x) ?? 0, group: fileGroup(x) })),
      origins: (['curated', 'fetched'] as Origin[]).map((o): Option => ({ value: o, label: ORIGIN_LABEL[o], count: ori.get(o) ?? 0 })),
    };
  }, [items, f]);

  // ── active pills (each clears itself) ──
  const set = <K extends keyof RefFilter>(k: K, v: RefFilter[K]) => setFilter((x) => ({ ...x, [k]: v }));
  const pills: ActivePill[] = [];
  if (filter.q.trim()) pills.push({ key: 'q', label: `“${filter.q.trim()}”`, onClear: () => set('q', '') });
  const listPills = <K extends 'sections' | 'kinds' | 'hosts' | 'files' | 'origins'>(k: K, name: string, fmt: (v: string) => string = (v) => v) => {
    for (const v of filter[k] as string[]) pills.push({ key: `${k}:${v}`, label: `${name}: ${fmt(v)}`, onClear: () => set(k, (filter[k] as string[]).filter((x) => x !== v) as RefFilter[K]) });
  };
  listPills('sections', 'Section');
  listPills('kinds', 'Kind', (v) => KIND_META[v as keyof typeof KIND_META]?.short ?? v);
  listPills('hosts', 'Domain');
  listPills('files', 'File');
  listPills('origins', 'Origin', (v) => (v === 'curated' ? 'curated' : 'fetched'));
  if (isRangeActive(filter.uses)) pills.push({ key: 'uses', label: `Used ${fmtUses(filter.uses.min ?? 1, cap)}–${fmtUses(filter.uses.max ?? cap, cap)}×`, onClear: () => set('uses', {}) });

  const clearAll = () => setFilter(EMPTY_FILTER);

  return (
    <Panel
      id="ref-list"
      kicker="Every reference"
      title={`${items.length.toLocaleString()} unique source URLs, with where each one is used`}
      actions={
        <Segmented
          label="Group by"
          value={group}
          onChange={setGroup}
          options={[
            { value: 'host', label: 'By domain' },
            { value: 'section', label: 'By section' },
            { value: 'none', label: 'Flat' },
          ]}
        />
      }
      footer={
        <span>
          Built by <code className="font-mono">scripts/build-references.ts</code> from data/curated/**.yaml, the fetchers and the fetched bundles. Epoch’s per-row source links are
          folded into one entry per leaderboard; its thousands of run logs are one entry for logs.epoch.ai.
        </span>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SearchInput value={filter.q} onChange={(q) => set('q', q)} placeholder="Search title, URL, domain or usage…" className="w-full sm:w-[300px]" />
        <MultiSelect label="Section" options={opts.sections} value={filter.sections} onChange={(v) => set('sections', v as Section[])} width={260} />
        <MultiSelect label="Kind" options={opts.kinds} value={filter.kinds} onChange={(v) => set('kinds', v as RefFilter['kinds'])} width={280} />
        <MultiSelect label="Domain" options={opts.hosts} value={filter.hosts} onChange={(v) => set('hosts', v)} width={320} searchable />
        <MultiSelect label="File" options={opts.files} value={filter.files} onChange={(v) => set('files', v)} width={340} searchable />
        <MultiSelect label="Origin" options={opts.origins} value={filter.origins} onChange={(v) => set('origins', v as Origin[])} width={260} />
        <RangeFilter label="Used in" domain={[1, cap]} value={filter.uses} onChange={(v) => set('uses', v)} format={(n) => fmtUses(n, cap)} />
        <SingleSelect label="Sort" options={SORTS} value={sort} onChange={setSort} defaultValue="used" width={220} />
      </div>
      <div className="mb-4">
        <ActiveFilters pills={pills} onClearAll={clearAll} count={filtered.length} total={items.length} noun="sources" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-2 px-4 py-12 text-center">
          <div className="text-[14px] font-medium text-ink">No sources match these filters</div>
          <p className="mt-1 text-[12.5px] text-ink-3">Try a shorter search, or widen the section, kind or domain filters.</p>
          {isFilterActive(filter) && (
            <button type="button" onClick={clearAll} className="mt-4 rounded-full border border-line-2 px-4 py-1.5 text-[12px] text-ink-2 hover:text-ink">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className={`transition-opacity ${stale ? 'opacity-60' : ''}`}>
          {page.groups.map((g) => (
            <section key={g.key} className="mb-4 last:mb-0">
              {group !== 'none' && (
                <GroupHeader
                  group={group}
                  label={g.label}
                  rows={g.total}
                  count={g.count}
                  onlyThis={group === 'host' ? (filter.hosts.length === 1 && filter.hosts[0] === g.key ? undefined : () => set('hosts', [g.key])) : undefined}
                />
              )}
              <ul className="divide-y divide-line">
                {g.rows.map((r) => (
                  <Row key={r.url} r={r} q={f.q} open={open.has(r.url)} onToggle={toggleOpen} showHost={group !== 'host'} />
                ))}
              </ul>
              {g.rows.length < g.total && (
                <button
                  type="button"
                  onClick={() => setLim({ sig, n: cur.n + (g.total - g.rows.length), groups: new Set([...cur.groups, g.key]) })}
                  className="ml-1 mt-1 rounded-full px-2 py-1 text-[11.5px] text-ink-3 hover:bg-surface-2/70 hover:text-ink"
                >
                  + Show all {g.total.toLocaleString()} in {g.label}
                </button>
              )}
            </section>
          ))}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-[12px]">
            <span className="mr-auto text-ink-3">
              Showing <span className="font-mono text-ink tnum">{page.shown.toLocaleString()}</span> of <span className="font-mono tnum">{page.total.toLocaleString()}</span> rows
              {group !== 'none' && (
                <>
                  {' '}
                  in <span className="font-mono tnum">{page.groups.length.toLocaleString()}</span> of <span className="font-mono tnum">{groups.length.toLocaleString()}</span> groups
                </>
              )}
            </span>
            {page.more && (
              <>
                <button type="button" onClick={() => setLim({ sig, n: cur.n + PAGE, groups: cur.groups })} className="rounded-full border border-line-2 px-3.5 py-1.5 text-ink-2 hover:text-ink">
                  Show more
                </button>
                <button
                  type="button"
                  onClick={() => setLim({ sig, n: page.total, groups: new Set(groups.map((g) => g.key)) })}
                  className="rounded-full px-3 py-1.5 text-ink-3 underline decoration-line-2 underline-offset-2 hover:text-ink"
                >
                  Show all {page.total.toLocaleString()}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

const fmtUses = (n: number, cap: number) => (n >= cap ? `${cap}+` : String(n));

function GroupHeader({ group, label, rows, count, onlyThis }: { group: GroupKey; label: string; rows: number; count: number; onlyThis?: () => void }) {
  const section = group === 'section' ? (label as Section) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 pb-2 pt-3">
      {group === 'host' && <Monogram host={label} size="sm" />}
      <div className="min-w-0">
        <span className="text-[13.5px] font-semibold tracking-tight text-ink">{label}</span>
        {section && <span className="ml-2 hidden text-[12px] text-ink-3 sm:inline">{SECTION_HINT[section]}</span>}
      </div>
      <span className="font-mono text-[11px] text-ink-3 tnum">
        {rows.toLocaleString()} source{rows === 1 ? '' : 's'} · {count.toLocaleString()} citation{count === 1 ? '' : 's'}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {onlyThis && (
          <button type="button" onClick={onlyThis} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3 hover:border-line-2 hover:text-ink">
            Only this domain
          </button>
        )}
        {group === 'host' && (
          <a href={`https://${label}`} target="_blank" rel="noreferrer noopener" className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3 hover:border-line-2 hover:text-ink">
            Visit ↗
          </a>
        )}
        {section && (
          <button type="button" onClick={() => setTab(SECTION_TAB[section])} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3 hover:border-line-2 hover:text-ink">
            Open tab →
          </button>
        )}
      </span>
    </div>
  );
}

const USAGE_PREVIEW = 12;

const Row = memo(function Row({ r, q, open, onToggle, showHost }: { r: Item; q: string; open: boolean; onToggle: (url: string) => void; showHost: boolean }) {
  const [all, setAll] = useState(false);
  const bySection = SECTIONS.map((s) => {
    const us = r.usedIn.filter((u) => u.section === s);
    return { s, us, n: us.reduce((k, u) => k + (u.n ?? 1), 0) };
  }).filter((x) => x.us.length);
  const shown = all ? r.usedIn : r.usedIn.slice(0, USAGE_PREVIEW);
  const path = displayUrl(r.url).slice(r.host.length) || '/';
  return (
    <li className={`grid gap-x-3 px-1 py-2.5 sm:px-2 ${showHost ? 'grid-cols-[24px_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto]'}`}>
      {showHost && (
        <span className="pt-0.5">
          <Monogram host={r.host} size="sm" />
        </span>
      )}
      <div className="min-w-0">
        <a href={r.url} target="_blank" rel="noreferrer noopener" className="line-clamp-2 text-[13.5px] font-medium leading-snug text-ink hover:underline hover:decoration-line-2 hover:underline-offset-2">
          <Hi text={r.title} q={q} />
        </a>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
          <KindBadge kind={r.kind} />
          {r.origins.includes('fetched') && (
            <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10.5px]" title={r.origins.length > 1 ? 'Curated, and also found in a live feed' : 'Comes from a live feed'}>
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              live
            </span>
          )}
          <span className="min-w-0 max-w-full truncate font-mono text-[11px] sm:max-w-[min(460px,50%)]" title={r.url}>
            <Hi text={showHost ? displayUrl(r.url) : path} q={q} />
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            {bySection.map(({ s, us, n }) => (
              <button
                key={s}
                type="button"
                aria-expanded={open}
                onClick={() => onToggle(r.url)}
                title={`${s}:\n${us
                  .slice(0, 6)
                  .map((u) => `• ${u.context}${u.n ? ` (×${u.n})` : ''}`)
                  .join('\n')}${us.length > 6 ? `\n+${us.length - 6} more` : ''}`}
                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10.5px] transition-colors ${open ? 'border-line-2 bg-surface-3 text-ink' : 'border-line text-ink-2 hover:border-line-2 hover:text-ink'}`}
              >
                {s}
                <span className="font-mono text-[10px] text-ink-3 tnum">{n.toLocaleString()}</span>
              </button>
            ))}
            {r.grouped && <span className="rounded-full border border-dashed border-line-2 px-1.5 py-px text-[10.5px]">folded from {r.grouped.toLocaleString()} URLs</span>}
            <button type="button" onClick={() => onToggle(r.url)} aria-expanded={open} className="px-1 text-[11px] text-ink-3 hover:text-ink">
              {open ? 'hide ▴' : `${r.usedIn.length} use${r.usedIn.length === 1 ? '' : 's'} ▾`}
            </button>
          </span>
        </div>
        {open && (
          <div className="mt-2 rounded-xl border border-line bg-surface/60 p-2.5">
            <ul className="space-y-1.5">
              {shown.map((u, i) => (
                <li key={i} className="grid grid-cols-1 gap-x-3 text-[12px] leading-snug sm:grid-cols-[92px_minmax(0,1fr)]">
                  <span className="font-mono text-[10.5px] text-ink-3 sm:pt-px">{u.section}</span>
                  <span className="min-w-0 text-ink-2">
                    <Hi text={u.context} q={q} />
                    {u.n ? <span className="ml-1 font-mono text-[10.5px] text-ink-3">×{u.n}</span> : null}
                    <span className="ml-2 break-all font-mono text-[10.5px] text-ink-3">{u.file}</span>
                  </span>
                </li>
              ))}
            </ul>
            {r.usedIn.length > USAGE_PREVIEW && (
              <button type="button" onClick={() => setAll((a) => !a)} className="mt-2 text-[11.5px] text-ink-3 underline decoration-line-2 underline-offset-2 hover:text-ink">
                {all ? 'Show fewer' : `Show all ${r.usedIn.length} uses`}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex items-start gap-2 pt-px">
        <span className="pt-0.5 font-mono text-[12px] text-ink tnum" title={`${r.count.toLocaleString()} citations`}>
          {r.count.toLocaleString()}
          <span className="text-[10px] text-ink-3">×</span>
        </span>
        <a
          href={r.url}
          target="_blank"
          rel="noreferrer noopener"
          tabIndex={-1}
          aria-hidden
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-line text-[11px] text-ink-3 hover:border-line-2 hover:text-ink"
        >
          ↗
        </a>
      </div>
    </li>
  );
});
