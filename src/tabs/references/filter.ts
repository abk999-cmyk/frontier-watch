/** Pure filtering, faceting, sorting, grouping and paging for the reference list. */
import { countBy, inRange, isRangeActive, matchAny, textMatch, type RangeValue } from '../../lib/filters.ts';
import { KINDS, SECTIONS, type Kind, type Origin, type Ref, type Section } from './types.ts';

export interface Item extends Ref {
  sections: Section[];
  files: string[];
  /** Lower-cased search haystack: title, url, host and every usage context. */
  hay: string;
}

export interface RefFilter {
  q: string;
  sections: Section[];
  kinds: Kind[];
  hosts: string[];
  files: string[];
  origins: Origin[];
  uses: RangeValue;
}
export const EMPTY_FILTER: RefFilter = { q: '', sections: [], kinds: [], hosts: [], files: [], origins: [], uses: {} };

export type SortKey = 'used' | 'az' | 'host';
export type GroupKey = 'host' | 'section' | 'none';

export function prepare(refs: Ref[]): Item[] {
  return refs.map((r) => {
    const sections = SECTIONS.filter((s) => r.usedIn.some((u) => u.section === s));
    const files = [...new Set(r.usedIn.map((u) => u.file))];
    const hay = [r.title, r.url, r.host, ...r.usedIn.map((u) => `${u.file} ${u.context}`)].join(' \u0001 ').toLowerCase();
    return { ...r, sections, files, hay };
  });
}

/** True if the item passes every filter except `skip` (used for "other filters applied" facet counts). */
export function passes(it: Item, f: RefFilter, skip?: keyof RefFilter): boolean {
  return (
    (skip === 'q' || textMatch(it.hay, f.q)) &&
    (skip === 'sections' || matchAny(it.sections, f.sections)) &&
    (skip === 'kinds' || matchAny(it.kind, f.kinds)) &&
    (skip === 'hosts' || matchAny(it.host, f.hosts)) &&
    (skip === 'files' || matchAny(it.files, f.files)) &&
    (skip === 'origins' || matchAny(it.origins, f.origins)) &&
    (skip === 'uses' || inRange(it.count, f.uses))
  );
}

export const applyFilter = (items: Item[], f: RefFilter) => items.filter((it) => passes(it, f));

/** Facet counts for one dimension, with every *other* filter applied. */
export function facet(items: Item[], f: RefFilter, key: 'sections' | 'kinds' | 'hosts' | 'files' | 'origins'): Map<string, number> {
  const pool = items.filter((it) => passes(it, f, key));
  const get: Record<typeof key, (it: Item) => string | string[]> = {
    sections: (it) => it.sections,
    kinds: (it) => it.kind,
    hosts: (it) => it.host,
    files: (it) => it.files,
    origins: (it) => it.origins,
  };
  return countBy(pool, get[key]);
}

export const isFilterActive = (f: RefFilter) =>
  !!f.q.trim() || f.sections.length > 0 || f.kinds.length > 0 || f.hosts.length > 0 || f.files.length > 0 || f.origins.length > 0 || isRangeActive(f.uses);

const titleKey = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase();

export function sortItems(items: Item[], sort: SortKey): Item[] {
  const out = [...items];
  if (sort === 'used') out.sort((a, b) => b.count - a.count || titleKey(a.title).localeCompare(titleKey(b.title)));
  else if (sort === 'az') out.sort((a, b) => titleKey(a.title).localeCompare(titleKey(b.title)) || b.count - a.count);
  else out.sort((a, b) => a.host.localeCompare(b.host) || b.count - a.count || titleKey(a.title).localeCompare(titleKey(b.title)));
  return out;
}

export interface Group {
  key: string;
  label: string;
  rows: Item[];
  /** Sum of citations across the group's rows. */
  count: number;
}

/** Group sorted items. Section grouping lists a reference under every section that uses it. */
export function groupItems(sorted: Item[], by: GroupKey, sort: SortKey, onlySections: Section[] = []): Group[] {
  if (by === 'none') return [{ key: 'all', label: 'All sources', rows: sorted, count: sorted.reduce((s, r) => s + r.count, 0) }];
  if (by === 'section') {
    const shown = onlySections.length ? SECTIONS.filter((s) => onlySections.includes(s)) : SECTIONS;
    return shown
      .map((s) => {
        const rows = sorted.filter((r) => r.sections.includes(s));
        return { key: s, label: s, rows, count: rows.reduce((n, r) => n + r.count, 0) };
      })
      .filter((g) => g.rows.length);
  }
  const m = new Map<string, Item[]>();
  for (const r of sorted) (m.get(r.host) ?? m.set(r.host, []).get(r.host)!).push(r);
  const groups = [...m].map(([host, rows]) => ({ key: host, label: host, rows, count: rows.reduce((n, r) => n + r.count, 0) }));
  if (sort === 'used') groups.sort((a, b) => b.count - a.count || b.rows.length - a.rows.length || a.label.localeCompare(b.label));
  else groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

/**
 * Page grouped rows: each group shows at most `perGroup` rows unless its key is in `expanded`,
 * and groups are added in order until `limit` rows are on screen (the last one may be cut short).
 * `total` counts every row across all groups, so "N of total" stays honest.
 */
export function pageGroups(
  groups: Group[],
  limit: number,
  perGroup = Infinity,
  expanded: ReadonlySet<string> = new Set(),
): { groups: (Group & { total: number })[]; shown: number; total: number; more: boolean } {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const out: (Group & { total: number })[] = [];
  let left = limit;
  let more = false;
  for (const g of groups) {
    if (left <= 0) {
      more = true;
      break;
    }
    const cap = expanded.has(g.key) ? g.rows.length : Math.min(perGroup, g.rows.length);
    const take = Math.min(left, cap);
    if (take < cap) more = true;
    out.push({ ...g, rows: g.rows.slice(0, take), total: g.rows.length });
    left -= take;
  }
  return { groups: out, shown: limit - left, total, more };
}

/** Domain for the "used in" range: 1…cap, where the top of the slider means "cap or more". */
export function usesCap(items: Item[]): number {
  if (!items.length) return 10;
  const counts = items.map((i) => i.count).sort((a, b) => a - b);
  const p95 = counts[Math.floor(counts.length * 0.95)] ?? counts.at(-1)!;
  return Math.max(10, Math.min(50, p95));
}

// ── Deep links: #references?q=…&section=…&kind=…&host=…&file=…&origin=… ──
const LIST_KEYS = { section: 'sections', kind: 'kinds', host: 'hosts', file: 'files', origin: 'origins' } as const;

export function fromQuery(qs: string): RefFilter {
  const p = new URLSearchParams(qs);
  const f: RefFilter = { ...EMPTY_FILTER, q: p.get('q') ?? '' };
  for (const [param, key] of Object.entries(LIST_KEYS)) {
    const vals = p.getAll(param).flatMap((v) => v.split(',')).filter(Boolean);
    if (key === 'sections') f.sections = vals.filter((v): v is Section => (SECTIONS as readonly string[]).includes(v));
    else if (key === 'kinds') f.kinds = vals.filter((v): v is Kind => (KINDS as readonly string[]).includes(v));
    else if (key === 'origins') f.origins = vals.filter((v): v is Origin => v === 'fetched' || v === 'curated');
    else f[key] = vals;
  }
  const min = Number(p.get('min'));
  if (Number.isFinite(min) && min > 1) f.uses = { min };
  return f;
}

export function toQuery(f: RefFilter): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  for (const [param, key] of Object.entries(LIST_KEYS)) if (f[key].length) p.set(param, f[key].join(','));
  if (f.uses.min !== undefined) p.set('min', String(f.uses.min));
  return p.toString();
}
