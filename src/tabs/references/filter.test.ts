import { describe, expect, it } from 'vitest';
import type { Ref } from './types.ts';
import { applyFilter, EMPTY_FILTER, facet, fromQuery, groupItems, pageGroups, prepare, sortItems, toQuery } from './filter.ts';

const ref = (url: string, title: string, kind: Ref['kind'], count: number, usedIn: Ref['usedIn'], origins: Ref['origins'] = ['curated']): Ref => ({
  url,
  host: new URL(url).hostname.replace(/^www\./, ''),
  title,
  kind,
  count,
  usedIn,
  origins,
});
const items = prepare([
  ref('https://arxiv.org/abs/1', 'Scaling laws', 'paper', 5, [{ section: 'Registry', file: 'models.yaml', context: 'GPT-4 (OpenAI)' }]),
  ref('https://arxiv.org/abs/2', 'AlphaFold', 'paper', 1, [{ section: 'Charts Lab', file: 'breakthroughs.yaml', context: 'protein structure' }]),
  ref('https://epoch.ai/benchmarks', 'Epoch AI Benchmarking Hub', 'leaderboard', 900, [
    { section: 'Benchmarks', file: 'scores.json', context: 'GPQA Diamond: 118 rows', n: 118 },
    { section: 'Charts Lab', file: 'scripts/fetch/epoch.ts', context: 'ECI trends' },
  ], ['fetched']),
]);

describe('filtering', () => {
  it('matches search across title, url and usage context', () => {
    expect(applyFilter(items, { ...EMPTY_FILTER, q: 'gpqa' }).map((i) => i.title)).toEqual(['Epoch AI Benchmarking Hub']);
    expect(applyFilter(items, { ...EMPTY_FILTER, q: 'arxiv protein' }).map((i) => i.title)).toEqual(['AlphaFold']);
  });
  it('combines section, kind and used-in filters', () => {
    expect(applyFilter(items, { ...EMPTY_FILTER, sections: ['Charts Lab'], kinds: ['paper'] })).toHaveLength(1);
    expect(applyFilter(items, { ...EMPTY_FILTER, uses: { min: 5 } })).toHaveLength(2);
    expect(applyFilter(items, { ...EMPTY_FILTER, origins: ['fetched'] })).toHaveLength(1);
  });
  it('computes facets with the other filters applied', () => {
    const f = { ...EMPTY_FILTER, kinds: ['paper' as const] };
    expect(facet(items, f, 'sections').get('Charts Lab')).toBe(1);
    expect(facet(items, f, 'kinds').get('leaderboard')).toBe(1); // own dimension ignored
  });
});

describe('sorting, grouping, paging', () => {
  it('groups by host with the busiest host first', () => {
    const g = groupItems(sortItems(items, 'used'), 'host', 'used');
    expect(g.map((x) => x.label)).toEqual(['epoch.ai', 'arxiv.org']);
  });
  it('lists a reference under every section that uses it', () => {
    const g = groupItems(sortItems(items, 'az'), 'section', 'az');
    expect(g.find((x) => x.key === 'Charts Lab')!.rows).toHaveLength(2);
    expect(groupItems(sortItems(items, 'az'), 'section', 'az', ['Registry']).map((x) => x.key)).toEqual(['Registry']);
  });
  it('pages across groups by row budget', () => {
    const g = groupItems(sortItems(items, 'used'), 'host', 'used');
    const p = pageGroups(g, 2);
    expect(p.shown).toBe(2);
    expect(p.total).toBe(3);
    expect(p.groups.map((x) => x.rows.length)).toEqual([1, 1]);
    expect(p.groups[1].total).toBe(2);
    expect(p.more).toBe(true);
  });
  it('caps each group unless it is expanded', () => {
    const g = groupItems(sortItems(items, 'used'), 'host', 'used');
    expect(pageGroups(g, 60, 1).groups.map((x) => x.rows.length)).toEqual([1, 1]);
    expect(pageGroups(g, 60, 1, new Set(['arxiv.org'])).groups.map((x) => x.rows.length)).toEqual([1, 2]);
    expect(pageGroups(g, 60, 1, new Set(['arxiv.org'])).more).toBe(false);
  });
});

describe('deep links', () => {
  it('round-trips filters through the hash query', () => {
    const f = { ...EMPTY_FILTER, q: 'swe bench', sections: ['Benchmarks' as const], hosts: ['arxiv.org'], uses: { min: 3 } };
    expect(fromQuery(toQuery(f))).toEqual(f);
    expect(fromQuery('kind=paper,bogus&section=Nope')).toEqual({ ...EMPTY_FILTER, kinds: ['paper'] });
  });
});
