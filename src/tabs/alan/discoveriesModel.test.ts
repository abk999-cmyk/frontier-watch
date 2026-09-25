import { describe, expect, it } from 'vitest';
import alan from '../../../public/data/alan.json';
import charts from '../../../public/data/charts.json';
import {
  activeDiscFilterCount,
  buildDiscoveries,
  discFacets,
  discStats,
  EMPTY_DISC_FILTERS,
  filterDiscoveries,
  fmtDiscDate,
  orgParts,
  sortDiscoveries,
  type AlanDiscovery,
  type DiscFilters,
} from './discoveriesModel.ts';

const curated = [
  {
    id: 'erdos-728',
    date: '2026-01-06T00:00:00.000Z',
    title: 'Erdős problem #728 solved',
    domain: 'math',
    field: 'number theory',
    system: 'Aristotle',
    model: 'GPT-5.2 Pro',
    org: 'OpenAI / Harmonic (operated by Kevin Barreto)',
    significance: 2,
    verification: 'formal-proof',
    autonomy: 'autonomous',
    tags: ['erdos', 'lean', 'erdos'],
    problem: 'Erdős #728',
    alanRef: 12,
    summary: 'Solved more or less autonomously.',
    url: 'https://example.com/728',
  },
  { id: 'alphafold2', date: '2020-11-30', title: 'AlphaFold 2', domain: 'science', field: 'structural biology', system: 'AlphaFold 2', org: 'DeepMind', significance: 5, verification: 'peer-reviewed', autonomy: 'tool', url: 'https://example.com/af2' },
  { id: 'claimed-thing', date: '2026-08', title: 'Claimed result', domain: 'science', significance: '3', verification: 'claimed', org: 'Anthropic (elicited by David Roe)', url: 'https://example.com/c' },
  { id: 'bad-verif', date: '2025-05-01', title: 'Odd fields', domain: 'chemistry', significance: 9, verification: 'rumoured', autonomy: 'magic', alanRef: [99] },
  { id: 'no-title', date: '2025-01-01' },
];
const alanRows: AlanDiscovery[] = [
  { n: 12, model: 'GPT-5.2', discovery: 'Erdős #728', org: 'OpenAI', date: '2026-01-01', url: 'https://x.com/1' },
  { n: 13, model: 'Claude S4.5', discovery: 'Found a new enzyme', org: 'Stanford', date: '2025-11-01' },
  { n: 14, model: 'Gemini/AE', discovery: 'Better matrix multiplication', org: 'GDM', date: 'sometime' },
];

const list = buildDiscoveries(curated, alanRows);
const get = (id: string) => list.find((d) => d.id === id)!;

describe('merge', () => {
  it('merges Alan rows referenced by alanRef and drops them as standalone entries', () => {
    expect(get('erdos-728')).toMatchObject({ source: 'both', date: '2026-01-06', precision: 'day', problem: 'Erdős #728', tags: ['erdos', 'lean'] });
    expect(get('erdos-728').alan.map((r) => r.n)).toEqual([12]);
    expect(list.find((d) => d.id === 'alan-12')).toBeUndefined();
  });
  it('keeps unreferenced Alan rows with unknown grades', () => {
    expect(get('alan-13')).toMatchObject({ source: 'alan', significance: null, verification: null, autonomy: null, domain: null, precision: 'month', date: '2025-11-01', labs: ['anthropic'] });
    expect(get('alan-14')).toMatchObject({ date: null, orgs: ['Google DeepMind'], labs: ['google'] });
  });
  it('guards bad and missing curated fields', () => {
    expect(get('bad-verif')).toMatchObject({ domain: null, verification: null, autonomy: null, significance: 5, source: 'curated', tags: [], problem: null, model: null });
    expect(get('claimed-thing')).toMatchObject({ significance: 3, precision: 'month', date: '2026-08-01' });
    expect(list.find((d) => d.id === 'no-title')).toBeUndefined();
    expect(buildDiscoveries(undefined, undefined)).toEqual([]);
  });
  it('builds model and lab facets from model, system and Alan rows', () => {
    expect(get('erdos-728').models).toEqual(['GPT-5.2 Pro', 'Aristotle', 'GPT-5.2']);
    expect(get('erdos-728').labs).toEqual(['openai']);
    expect(get('alphafold2').labs).toEqual(['google']);
  });
  it('sorts newest first, undated last', () => {
    expect(list[0].id).toBe('claimed-thing');
    expect(list.at(-1)!.id).toBe('alan-14');
  });
});

describe('orgParts', () => {
  it('splits, strips parentheticals and merges DeepMind spellings', () => {
    expect(orgParts('Google DeepMind / Isomorphic Labs')).toEqual(['Google DeepMind', 'Isomorphic Labs']);
    expect(orgParts('DeepMind with University of Oxford and University of Sydney mathematicians')).toEqual(['Google DeepMind']);
    expect(orgParts('Anthropic (elicited by David Roe)')).toEqual(['Anthropic']);
    expect(orgParts('UoT/HMS')).toEqual(['UoT', 'HMS']);
    expect(orgParts('GDM')).toEqual(['Google DeepMind']);
    expect(orgParts(null)).toEqual([]);
  });
});

describe('filters', () => {
  const f = (p: Partial<DiscFilters>): DiscFilters => ({ ...EMPTY_DISC_FILTERS, ...p });
  const ids = (p: Partial<DiscFilters>) => filterDiscoveries(list, f(p)).map((d) => d.id).sort();
  it('significance range excludes unrated rows', () => {
    expect(ids({ sig: { min: 3 } })).toEqual(['alphafold2', 'bad-verif', 'claimed-thing']);
    expect(ids({ sig: { max: 2 } })).toEqual(['erdos-728']);
  });
  it('source list: curated / Alan / both', () => {
    expect(ids({ source: 'alan' })).toEqual(['alan-13', 'alan-14', 'erdos-728']);
    expect(ids({ source: 'curated' })).toEqual(['alphafold2', 'bad-verif', 'claimed-thing', 'erdos-728']);
    expect(ids({ source: 'both' })).toEqual(['erdos-728']);
  });
  it('facets, unknown buckets, problems, text and dates', () => {
    expect(ids({ verifs: ['unknown'] })).toEqual(['alan-13', 'alan-14', 'bad-verif']);
    expect(ids({ domains: ['math'] })).toEqual(['erdos-728']);
    expect(ids({ orgs: ['Google DeepMind'] })).toEqual(['alan-14', 'alphafold2']);
    expect(ids({ labs: ['none'] })).toEqual(['bad-verif']);
    expect(ids({ hasProblem: true })).toEqual(['erdos-728']);
    expect(ids({ tags: ['lean'] })).toEqual(['erdos-728']);
    expect(ids({ q: 'enzyme stanford' })).toEqual(['alan-13']);
    expect(ids({ q: '#12' })).toEqual(['erdos-728']);
    expect(ids({ date: { mode: 'before', to: '2021-01-01' } })).toEqual(['alphafold2']);
  });
  it('facet counts ignore their own selection', () => {
    const facets = discFacets(list, f({ domains: ['math'], source: 'curated' }));
    expect(facets.domains.get('science')).toBe(2);
    expect(facets.domains.get('unknown')).toBe(1); // bad-verif (curated, no valid domain)
    expect(facets.sources).toEqual({ any: 1, curated: 1, alan: 1, both: 1 });
    expect(activeDiscFilterCount(f({ domains: ['math'], source: 'curated', q: 'x' }))).toBe(2);
  });
});

describe('sorting, stats, dates', () => {
  it('sorts by any column with missing values last', () => {
    expect(sortDiscoveries(list, 'significance', 'desc').map((d) => d.significance)).toEqual([5, 5, 3, 2, null, null]);
    expect(sortDiscoveries(list, 'significance', 'asc').map((d) => d.significance)).toEqual([2, 3, 5, 5, null, null]);
    expect(sortDiscoveries(list, 'verification', 'desc')[0].id).toBe('erdos-728');
    expect(sortDiscoveries(list, 'date', 'asc')[0].id).toBe('alphafold2');
  });
  it('counts totals, last 12 months and verified', () => {
    expect(discStats(list, '2026-09-24')).toEqual({ total: 6, last12: 3, verified: 2, inAlan: 3 });
  });
  it('formats dates at their precision', () => {
    expect(fmtDiscDate({ date: '2026-01-06', precision: 'day' })).toBe('Jan 6, 2026');
    expect(fmtDiscDate({ date: '2025-11-01', precision: 'month' })).toBe('Nov 2025');
    expect(fmtDiscDate({ date: null, precision: 'day' })).toBe('Undated');
  });
});

describe('real data', () => {
  it('merges charts.json breakthroughs with alan.json discoveries without losing rows', () => {
    const real = buildDiscoveries((charts as any).breakthroughs, (alan as any).asi.discoveries);
    const refs = new Set(((charts as any).breakthroughs as any[]).flatMap((b) => (b.alanRef == null ? [] : [].concat(b.alanRef))).map(Number));
    const alanN = ((alan as any).asi.discoveries as AlanDiscovery[]).map((r) => r.n);
    const unreferenced = alanN.filter((n) => !refs.has(n)).length;
    expect(real.length).toBe((charts as any).breakthroughs.length + unreferenced);
    expect(new Set(real.map((d) => d.id)).size).toBe(real.length);
  });
});
