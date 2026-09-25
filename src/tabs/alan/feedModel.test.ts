import { describe, expect, it } from 'vitest';
import type { AgiData, AsiData, AsiItem } from '../../../shared/types.ts';
import alan from '../../../public/data/alan.json';
import {
  activeFeedFilterCount,
  asiChanges,
  binInDate,
  buildFeed,
  detectLabs,
  EMPTY_FEED_FILTERS,
  feedFacets,
  feedStats,
  filterFeed,
  groupByMonth,
  histogramAxis,
  monthEnd,
  monthHistogram,
  normHost,
  pickBin,
  sortFeed,
  splitTitle,
  type FeedFilters,
} from './feedModel.ts';

const L = (label = 'src', url = 'https://example.com/a') => ({ label, url });

// Alan's logs are newest-first; within a month the earlier array index is the newer entry.
const agiLog: AgiData['log'] = [
  { date: '2026-02-01', kind: 'info', title: 'Claude Opus note', summary: 'Anthropic shipped something.', links: [] },
  { date: '2026-02-01', kind: 'pct', value: 97, title: 'Gemini 3 Deep Think', summary: 'Google DeepMind result.', links: [L('Announce', 'https://www.deepmind.google/x')] },
  { date: '2026-02-01', kind: 'pct', value: 96, title: 'Same month, older', summary: '', links: [] },
  { date: '2026-01-01', kind: 'pct', value: 96, title: 'GPT-5.2 Pro', summary: 'OpenAI model.', links: [L('Tweet', 'https://twitter.com/x/status/1')] },
  { date: '2025-12-01', kind: 'pct', value: 94, title: '', summary: 'Grok 4 from xAI. Longer explanation follows here.', links: [] },
];

const item = (id: number, phase: 1 | 2 | 3, type: string, keyword: string): AsiItem => ({ id, phase, label: `Indicator ${id}`, keyword, type, status: 'partial', links: [] });
const asi: Pick<AsiData, 'log' | 'events' | 'items'> = {
  items: [item(4, 1, 'Computing', 'Math'), item(6, 1, 'Computing', 'Science'), item(33, 3, 'Body', 'Robots')],
  events: [{ date: '2025-11-01', ids: [6], achieved: false }],
  log: [
    { date: '2026-05-01', ids: [{ id: 4, status: 'achieved' }], title: 'Erdős unit distance disproved', summary: 'An internal OpenAI model.', links: [L('paper', 'https://arxiv.org/abs/1')] },
    { date: '2026-03-01', ids: [{ id: 4, status: 'partial' }, { id: 6, status: 'partial' }], title: 'More math', summary: 'Gemini again.', links: [] },
    { date: '2026-03-01', ids: [{ id: 33, status: 'partial' }], title: 'Figure 03 humanoids at work', summary: 'Figure AI robots.', links: [L('video', 'https://youtu.be/abc')] },
    { date: '2026-02-01', ids: [], title: 'INFO: a note', summary: '', links: [] },
    { date: '2025-12-01', ids: [{ id: 6, status: 'partial' }], title: 'Science evidence', summary: '', links: [] },
  ],
};

const feed = buildFeed({ log: agiLog }, asi);
const byTitle = (t: string) => feed.find((e) => e.title === t)!;

describe('AGI deltas', () => {
  it('compares each % entry with the previous % entry in chronological order', () => {
    expect(byTitle('Gemini 3 Deep Think')).toMatchObject({ prevPct: 96, pct: 97, delta: 1, moved: true, type: 'agi-pct' });
    expect(byTitle('Same month, older')).toMatchObject({ prevPct: 96, delta: 0, moved: false });
    expect(byTitle('GPT-5.2 Pro')).toMatchObject({ prevPct: 94, delta: 2, moved: true });
  });
  it('treats the first % entry as a baseline, not a move', () => {
    const first = feed.find((e) => e.pct === 94)!;
    expect(first.prevPct).toBeNull();
    expect(first.delta).toBeNull();
    expect(first.moved).toBe(false);
  });
  it('info entries never move the needle', () => {
    expect(byTitle('Claude Opus note')).toMatchObject({ type: 'agi-info', moved: false, pct: null });
  });
  it('promotes the first sentence when a title is missing', () => {
    expect(splitTitle('', 'Grok 4 from xAI. Longer explanation follows here.')).toEqual({ title: 'Grok 4 from xAI.', summary: 'Longer explanation follows here.' });
    expect(splitTitle('Kept', 'body')).toEqual({ title: 'Kept', summary: 'body' });
    expect(splitTitle('', 'x'.repeat(300)).title.endsWith('…')).toBe(true);
  });
});

describe('ASI status changes', () => {
  it('marks first evidence and first achievement as status changes', () => {
    const erdos = byTitle('Erdős unit distance disproved');
    expect(erdos.indicators[0]).toMatchObject({ id: 4, status: 'achieved', change: 'achieved', keyword: 'Math', phase: 1, type: 'Computing' });
    expect(erdos.asiChange).toBe('status');
    expect(erdos.moved).toBe(true);
    const more = byTitle('More math');
    expect(more.indicators.find((i) => i.id === 4)!.change).toBe('first');
    expect(more.indicators.find((i) => i.id === 6)!.change).toBeNull(); // already partial in Dec 2025
    expect(more.asiChange).toBe('status');
  });
  it('counts earlier-month events as prior evidence', () => {
    // #6 has an event in Nov 2025, so the Dec 2025 log entry is "more evidence", not a change.
    expect(byTitle('Science evidence')).toMatchObject({ asiChange: 'evidence', moved: false });
    const noEvents = asiChanges(asi.log, []);
    const idx = asi.log.findIndex((l) => l.title === 'Science evidence');
    expect(noEvents.get(idx)!.get(6)).toBe('first');
  });
  it('entries without indicators have no ASI change', () => {
    expect(byTitle('INFO: a note')).toMatchObject({ asiChange: null, moved: false, indicators: [] });
  });
});

describe('mentions and links', () => {
  it('detects labs from product and company names', () => {
    expect(detectLabs('GPT-5.2 Pro and o3-mini beat Claude Opus 4.6')).toEqual(['openai', 'anthropic']);
    expect(detectLabs('Gemini 3 and AlphaEvolve from GDM')).toEqual(['google']);
    expect(detectLabs('Grok 4 by xAI, DeepSeek R2 and Kimi K3')).toEqual(['xai', 'deepseek', 'moonshot']);
    expect(detectLabs('Figure 03 on Helix; Meta Llama; Qwen 3')).toEqual(['meta', 'qwen', 'figure']);
  });
  it('avoids common-word false positives', () => {
    expect(detectLabs('see figure 3, a meta-analysis of o3 ideas')).toEqual(['openai']);
    expect(detectLabs('the double helix, a meta review')).toEqual([]);
  });
  it('normalises hosts', () => {
    expect(normHost('https://www.youtu.be/x')).toBe('youtube.com');
    expect(normHost('https://twitter.com/a')).toBe('x.com');
    expect(normHost('https://nytimes.com./a')).toBe('nytimes.com');
    expect(normHost('not a url')).toBe('');
    expect(byTitle('GPT-5.2 Pro').hosts).toEqual(['x.com']);
  });
});

describe('filters, facets and sorting', () => {
  const f = (p: Partial<FeedFilters>): FeedFilters => ({ ...EMPTY_FEED_FILTERS, ...p });
  it('moved-only keeps AGI rises and ASI status changes', () => {
    expect(filterFeed(feed, f({ moved: true })).map((e) => e.title).sort()).toEqual(['Erdős unit distance disproved', 'Figure 03 humanoids at work', 'GPT-5.2 Pro', 'Gemini 3 Deep Think', 'More math'].sort());
  });
  it('source-specific filters exclude entries without the attribute', () => {
    expect(filterFeed(feed, f({ pct: { min: 96 } })).every((e) => e.pct !== null && e.pct >= 96)).toBe(true);
    expect(filterFeed(feed, f({ phases: ['3'] })).map((e) => e.title)).toEqual(['Figure 03 humanoids at work']);
  });
  it('indicator-level filters must hold for the same indicator', () => {
    // "More math" has #4 (partial) and #6 (partial) — nothing achieved in phase 1 there.
    expect(filterFeed(feed, f({ indicators: ['6'], statuses: ['achieved'] }))).toEqual([]);
    expect(filterFeed(feed, f({ indicators: ['4'], statuses: ['achieved'] })).map((e) => e.title)).toEqual(['Erdős unit distance disproved']);
  });
  it('matches labs, hosts, links, text and dates', () => {
    expect(filterFeed(feed, f({ labs: ['figure'] })).map((e) => e.title)).toEqual(['Figure 03 humanoids at work']);
    expect(filterFeed(feed, f({ hosts: ['youtube.com'] })).length).toBe(1);
    expect(filterFeed(feed, f({ hasLinks: true })).every((e) => e.links.length > 0)).toBe(true);
    expect(filterFeed(feed, f({ q: 'erdős unit' })).length).toBe(1);
    expect(filterFeed(feed, f({ q: '#33' })).length).toBe(1);
    expect(filterFeed(feed, f({ date: { mode: 'between', from: '2026-02-01', to: '2026-02-28' } })).length).toBe(4);
  });
  it('facet counts ignore their own selection but respect the others', () => {
    const facets = feedFacets(feed, f({ sources: ['asi'], types: ['asi'] }));
    expect(facets.sources.get('agi')).toBeUndefined(); // types=asi excludes AGI entries
    expect(facets.sources.get('asi')).toBe(5);
    expect(facets.indicators.get('4')).toBe(2);
    expect(facets.moved).toBe(3);
    expect(activeFeedFilterCount(f({ sources: ['asi'], moved: true, q: 'x' }))).toBe(2);
  });
  it('sorts by date either way and by largest Δ', () => {
    expect(sortFeed(feed, 'oldest')[0].pct).toBe(94);
    expect(sortFeed(feed, 'newest')[0].title).toBe('Erdős unit distance disproved');
    const byDelta = sortFeed(feed, 'delta');
    expect(byDelta.slice(0, 2).map((e) => e.delta)).toEqual([2, 1]);
    expect(byDelta[2].asiChange).toBe('status');
  });
  it('groups consecutive entries by month', () => {
    const groups = groupByMonth(sortFeed(feed, 'newest'));
    expect(groups.map((g) => g.month)).toEqual(['2026-05', '2026-03', '2026-02', '2026-01', '2025-12']);
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(feed.length);
  });
});

describe('month histogram', () => {
  const dates = ['2017-08-01', '2021-06-01', '2025-01-01', '2025-03-01', '2025-03-01', '2026-09-01'];
  it('caps the axis and folds older entries into an earlier bin', () => {
    const axis = histogramAxis(dates, 24)!;
    expect(axis).toEqual({ start: '2024-10', end: '2026-09', hasEarlier: true });
    const h = monthHistogram(dates.map((date) => ({ date })), axis);
    expect(h.bins).toHaveLength(24);
    expect(h.earlier).toMatchObject({ count: 2, to: '2024-09-30' });
    expect(h.bins.find((b) => b.key === '2025-03')!.count).toBe(2);
    expect(histogramAxis([], 24)).toBeNull();
  });
  it('knows month ends, including leap years', () => {
    expect(monthEnd('2024-02')).toBe('2024-02-29');
    expect(monthEnd('2025-02-01')).toBe('2025-02-28');
    expect(monthEnd('2025-12')).toBe('2025-12-31');
  });
  it('click selects a month, click again clears, shift-click extends', () => {
    const mar = { from: '2025-03-01', to: '2025-03-31' };
    const jun = { from: '2025-06-01', to: '2025-06-30' };
    const one = pickBin({ mode: 'any' }, mar, false);
    expect(one).toEqual({ mode: 'between', ...mar });
    expect(pickBin(one, mar, false)).toEqual({ mode: 'any' });
    expect(pickBin(one, jun, true)).toEqual({ mode: 'between', from: '2025-03-01', to: '2025-06-30' });
    expect(pickBin({ mode: 'between', from: '2025-06-01', to: '2025-06-30' }, mar, true)).toEqual({ mode: 'between', from: '2025-03-01', to: '2025-06-30' });
    expect(pickBin({ mode: 'after', from: '2025-06-01' }, mar, true)).toEqual({ mode: 'after', from: '2025-03-01' });
    expect(pickBin({ mode: 'any' }, { from: null, to: '2021-09-30' }, false)).toEqual({ mode: 'before', to: '2021-09-30' });
  });
  it('highlights bins that overlap the date filter', () => {
    const mar = { from: '2025-03-01', to: '2025-03-31' };
    expect(binInDate(mar, { mode: 'any' })).toBe(false);
    expect(binInDate(mar, { mode: 'between', from: '2025-03-15', to: '2025-05-01' })).toBe(true);
    expect(binInDate(mar, { mode: 'after', from: '2025-04-01' })).toBe(false);
    expect(binInDate(mar, { mode: 'before', to: '2025-03-01' })).toBe(true);
    expect(binInDate({ from: null, to: '2021-09-30' }, { mode: 'before', to: '2020-01-01' })).toBe(true);
  });
});

describe('real alan.json', () => {
  const real = buildFeed((alan as any).agi, (alan as any).asi);
  it('keeps every log entry exactly once', () => {
    expect(real.length).toBe((alan as any).agi.log.length + (alan as any).asi.log.length);
    expect(new Set(real.map((e) => e.id)).size).toBe(real.length);
  });
  it('gives each indicator at most one first-evidence and one achieved change', () => {
    const seen = new Map<string, number>();
    for (const e of real) for (const i of e.indicators) if (i.change) seen.set(`${i.id}:${i.change}`, (seen.get(`${i.id}:${i.change}`) ?? 0) + 1);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
  });
  it('AGI deltas chain: each prevPct is the previous % entry', () => {
    const pcts = sortFeed(real, 'oldest').filter((e) => e.type === 'agi-pct');
    for (let i = 1; i < pcts.length; i++) expect(pcts[i].prevPct).toBe(pcts[i - 1].pct);
    const s = feedStats(real);
    expect(s.agiMoves).toBe(pcts.filter((e, i) => i > 0 && e.pct! > pcts[i - 1].pct!).length);
  });
});
