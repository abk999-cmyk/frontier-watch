import { describe, expect, it } from 'vitest';
import type { EciPoint, MetrPoint, Model } from '../../../shared/types.ts';
import { parseBreakthroughs, parseCommitments, qIndex } from './cbData.ts';
import {
  BT_EMPTY,
  btFields,
  COMMIT_EMPTY,
  buildModelIndex,
  filterBreakthroughs,
  filterCommitments,
  inDate,
  inScope,
  isSelected,
  matchWeights,
  multiPill,
  nextSort,
  numDomain,
  quarterMatches,
  rangePill,
  resolveOpen,
  searchRows,
  selectionOf,
  sortRows,
  type ScopeState,
} from './filterModel.ts';

const model = (id: string, name: string, labGroup: Model['labGroup'], released: string, openWeights: boolean | null): Model =>
  ({ id, name, lab: 'openai', labGroup, released, tier: 'flagship', status: 'released', openWeights }) as Model;
const eci = (name: string, labGroup: EciPoint['labGroup'], date: string, open: boolean, modelId?: string): EciPoint => ({ name, labGroup, date, open, modelId, org: '', eci: 150, low: 148, high: 152 });
const metr = (name: string, labGroup: MetrPoint['labGroup'], date: string, modelId?: string): MetrPoint => ({ name, labGroup, date, modelId, p50: 60 });

const MODELS = [model('gpt-5', 'GPT-5', 'openai', '2025-08-07', false), model('qwen3', 'Qwen3', 'china', '2025-04-29', null), model('claude-4', 'Claude 4', 'anthropic', '2025-05-22', false)];
const ECI = [
  eci('GPT-5 (high)', 'openai', '2025-08-07', false, 'gpt-5'),
  eci('Qwen3', 'china', '2025-04-29', true), // no modelId: merged into the registry entry by name
  eci('Llama 4 Maverick', 'other', '2025-04-05', true),
];
const METR = [metr('GPT-2 XL', 'openai', '2019-11-05'), metr('Claude 4', 'anthropic', '2025-05-22')];
const IDX = buildModelIndex(MODELS, ECI, METR);

describe('buildModelIndex', () => {
  it('unions registry, ECI and METR models without duplicates', () => {
    const keys = IDX.options.map((o) => o.key);
    expect(keys).toEqual(expect.arrayContaining(['gpt-5', 'qwen3', 'claude-4', 'n:llama4maverick', 'n:gpt2xl']));
    expect(keys).toHaveLength(5);
  });
  it('orders by lab group, then newest first', () => {
    expect(IDX.options.map((o) => o.key)).toEqual(['gpt-5', 'n:gpt2xl', 'claude-4', 'qwen3', 'n:llama4maverick']);
  });
  it('fills open-weights from Epoch when the registry is silent', () => {
    expect(IDX.options.find((o) => o.key === 'qwen3')!.open).toBe(true);
  });
});

describe('open weights', () => {
  it('resolves by registry id, then the source flag, then by name', () => {
    expect(resolveOpen({ modelId: 'gpt-5', name: 'whatever', open: true }, IDX)).toBe(false);
    expect(resolveOpen({ name: 'Unlisted', open: true }, IDX)).toBe(true);
    expect(resolveOpen({ name: 'llama 4 maverick' }, IDX)).toBe(true);
    expect(resolveOpen({ name: 'Mystery model' }, IDX)).toBeNull();
  });
  it('never lets unknown openness through an open/closed filter', () => {
    expect(matchWeights(null, 'all')).toBe(true);
    expect(matchWeights(null, 'open')).toBe(false);
    expect(matchWeights(null, 'closed')).toBe(false);
    expect(matchWeights(true, 'open')).toBe(true);
    expect(matchWeights(true, 'closed')).toBe(false);
  });
});

describe('model selection', () => {
  it('matches registry picks by id and by name, loose picks by name', () => {
    const sel = selectionOf(['gpt-5', 'n:llama4maverick'], IDX);
    expect(isSelected({ modelId: 'gpt-5', name: 'GPT-5 (high)' }, sel)).toBe(true);
    expect(isSelected({ name: 'gpt 5' }, sel)).toBe(true);
    expect(isSelected({ name: 'Llama-4 Maverick' }, sel)).toBe(true);
    expect(isSelected({ name: 'Claude 4', modelId: 'claude-4' }, sel)).toBe(false);
    expect(isSelected({ name: 'GPT-5' }, selectionOf([], IDX))).toBe(false);
  });
});

describe('inDate', () => {
  it('accepts ISO dates and epoch ms, inclusively', () => {
    const f = { mode: 'between' as const, from: '2025-01-01', to: '2025-06-30' };
    expect(inDate('2025-01-01', f)).toBe(true);
    expect(inDate(Date.UTC(2025, 5, 30), f)).toBe(true);
    expect(inDate(Date.UTC(2025, 6, 1), f)).toBe(false);
  });
  it('drops undated points only while a date filter is on', () => {
    expect(inDate(undefined, { mode: 'any' })).toBe(true);
    expect(inDate(null, { mode: 'after', from: '2024-01-01' })).toBe(false);
    expect(inDate(NaN, { mode: 'after', from: '2024-01-01' })).toBe(false);
  });
});

describe('inScope', () => {
  const base: ScopeState = { labs: new Set(['openai', 'anthropic', 'china', 'other']), date: { mode: 'any' }, weights: 'all', mode: 'highlight', sel: selectionOf([], IDX) };
  const gpt = { modelId: 'gpt-5', name: 'GPT-5', g: 'openai' as const, date: '2025-08-07' };
  const qwen = { name: 'Qwen3', g: 'china' as const, date: '2025-04-29' };
  it('applies labs, date and weights', () => {
    expect(inScope(gpt, base, IDX)).toBe(true);
    expect(inScope(gpt, { ...base, labs: new Set(['china']) }, IDX)).toBe(false);
    expect(inScope(gpt, { ...base, date: { mode: 'before', to: '2025-01-01' } }, IDX)).toBe(false);
    expect(inScope(gpt, { ...base, weights: 'open' }, IDX)).toBe(false);
    expect(inScope(qwen, { ...base, weights: 'open' }, IDX)).toBe(true);
  });
  it('only "show only" mode removes unpicked models', () => {
    const sel = selectionOf(['qwen3'], IDX);
    expect(inScope(gpt, { ...base, sel }, IDX)).toBe(true);
    expect(inScope(gpt, { ...base, sel, mode: 'only' }, IDX)).toBe(false);
    expect(inScope(qwen, { ...base, sel, mode: 'only' }, IDX)).toBe(true);
  });
});

describe('sortRows', () => {
  const rows = [{ v: 3 }, { v: null }, { v: 10 }, { v: 1 }, { v: undefined }];
  it('sorts numbers both ways with blanks always last', () => {
    expect(sortRows(rows, (r) => r.v, 'asc').map((r) => r.v)).toEqual([1, 3, 10, null, undefined]);
    expect(sortRows(rows, (r) => r.v, 'desc').map((r) => r.v)).toEqual([10, 3, 1, null, undefined]);
  });
  it('sorts strings naturally and stays stable on ties', () => {
    const names = [{ n: 'GPT-10', i: 0 }, { n: 'gpt-5', i: 1 }, { n: 'Claude', i: 2 }, { n: 'claude', i: 3 }];
    expect(sortRows(names, (r) => r.n, 'asc').map((r) => r.i)).toEqual([2, 3, 1, 0]);
  });
  it('does not mutate its input', () => {
    const copy = [...rows];
    sortRows(rows, (r) => r.v, 'asc');
    expect(rows).toEqual(copy);
  });
  it('cycles header clicks: text starts ascending, numbers descending, same column flips', () => {
    expect(nextSort(null, 'name', 'a')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort(null, 'score', 4)).toEqual({ key: 'score', dir: 'desc' });
    expect(nextSort({ key: 'score', dir: 'desc' }, 'score', 4)).toEqual({ key: 'score', dir: 'asc' });
  });
  it('searches every token across the haystack', () => {
    expect(searchRows(['GPT-5 openai', 'Claude anthropic'], (r) => r, 'open gpt')).toEqual(['GPT-5 openai']);
    expect(searchRows(['a', 'b'], (r) => r, '  ')).toEqual(['a', 'b']);
  });
});

describe('pills + domains', () => {
  it('summarises long selections', () => {
    expect(multiPill('k', 'Org', ['A', 'B', 'C', 'D'], (v) => v.toLowerCase(), () => {})!.label).toBe('Org: a, b +2');
    expect(multiPill('k', 'Org', [], (v) => v, () => {})).toBeNull();
    expect(rangePill('k', 'Tier', { min: 2 }, [0, 5], String, () => {})!.label).toBe('Tier: 2–5');
    expect(rangePill('k', 'Tier', {}, [0, 5], String, () => {})).toBeNull();
  });
  it('builds integer domains over finite values', () => {
    expect(numDomain([1.2, null, 7.8])).toEqual([1, 8]);
    expect(numDomain([], [0, 5])).toEqual([0, 5]);
    expect(numDomain([3, 3])).toEqual([3, 4]);
  });
});

describe('quarterMatches', () => {
  const q = qIndex('2025-Q2'); // Apr 1 – Jun 30
  it('keeps a quarter when any of its days is in the window', () => {
    expect(quarterMatches(q, { mode: 'any' })).toBe(true);
    expect(quarterMatches(q, { mode: 'after', from: '2025-06-15' })).toBe(true);
    expect(quarterMatches(q, { mode: 'after', from: '2025-07-01' })).toBe(false);
    expect(quarterMatches(q, { mode: 'before', to: '2025-04-01' })).toBe(true);
    expect(quarterMatches(q, { mode: 'before', to: '2025-03-31' })).toBe(false);
    expect(quarterMatches(q, { mode: 'between', from: '2025-05-01', to: '2025-05-02' })).toBe(true);
    expect(quarterMatches(q, { mode: 'between', from: '2025-07-01', to: '2025-12-31' })).toBe(false);
  });
});

describe('breakthrough filters', () => {
  const items = parseBreakthroughs([
    { id: 'a', date: '2020-11-30', title: 'AlphaFold 2', domain: 'science', field: 'structural biology', system: 'AlphaFold 2', org: 'DeepMind', significance: 5, verification: 'peer-reviewed', autonomy: 'tool', url: 'x' },
    { id: 'b', date: '2023-12-14', title: 'FunSearch cap sets', domain: 'math', field: 'combinatorics / number theory', system: 'FunSearch', org: 'DeepMind', significance: 2, verification: 'peer-reviewed', url: 'x', tags: ['open-problem'], model: 'PaLM 2' },
    { id: 'c', date: '2025-05-14', title: 'AlphaEvolve matrix multiplication', domain: 'math', field: 'algorithms', system: 'AlphaEvolve', org: 'Google DeepMind', significance: 3, verification: 'claimed', autonomy: 'autonomous', url: 'x', problem: '4x4 complex matrix multiplication' },
  ]);
  it('parses the optional fields', () => {
    expect(items[1].tags).toEqual(['open-problem']);
    expect(items[1].model).toBe('PaLM 2');
    expect(items[0].tags).toEqual([]);
    expect(items[2].problem).toMatch(/matrix/);
  });
  it('splits compound fields into facets', () => {
    expect(btFields(items[1])).toEqual(['combinatorics', 'number theory']);
  });
  it('combines facets with AND across filters, OR within one', () => {
    expect(filterBreakthroughs(items, { ...BT_EMPTY, fields: ['number theory', 'algorithms'] }).map((b) => b.id)).toEqual(['b', 'c']);
    expect(filterBreakthroughs(items, { ...BT_EMPTY, domains: ['math'], verifs: ['peer-reviewed'] }).map((b) => b.id)).toEqual(['b']);
    expect(filterBreakthroughs(items, { ...BT_EMPTY, sig: { min: 3 } }).map((b) => b.id)).toEqual(['a', 'c']);
    expect(filterBreakthroughs(items, { ...BT_EMPTY, date: { mode: 'after', from: '2023-01-01' } }).map((b) => b.id)).toEqual(['b', 'c']);
    expect(filterBreakthroughs(items, { ...BT_EMPTY, autonomy: ['unstated'] }).map((b) => b.id)).toEqual(['b']);
    expect(filterBreakthroughs(items, { ...BT_EMPTY, models: ['PaLM 2', 'AlphaFold 2'] }).map((b) => b.id)).toEqual(['a', 'b']);
    expect(filterBreakthroughs(items, { ...BT_EMPTY, tags: ['open-problem'] }).map((b) => b.id)).toEqual(['b']);
  });
  it('searches title, field, system, problem and tags', () => {
    expect(filterBreakthroughs(items, { ...BT_EMPTY, q: 'matrix 4x4' }).map((b) => b.id)).toEqual(['c']);
    expect(filterBreakthroughs(items, { ...BT_EMPTY, q: 'open-problem' }).map((b) => b.id)).toEqual(['b']);
  });
  it('skips one facet for its own option counts', () => {
    const f = { ...BT_EMPTY, orgs: ['DeepMind'], domains: ['math'] };
    expect(filterBreakthroughs(items, f).map((b) => b.id)).toEqual(['b']);
    expect(filterBreakthroughs(items, f, 'orgs').map((b) => b.id)).toEqual(['b', 'c']);
  });
});

describe('commitment filters', () => {
  const items = parseCommitments([
    { id: '1', date: '2025-01-21', company: 'openai', counterparties: ['SoftBank', 'Oracle'], title: 'Stargate', usdBillions: 500, status: 'announced' },
    { id: '2', date: '2025-09-10', company: 'openai', counterparties: ['Oracle'], title: 'Oracle cloud deal', usdBillions: 300, status: 'contracted' },
    { id: '3', date: '2025-10-01', company: 'anthropic', counterparties: ['Google'], title: 'TPU deal', gigawatts: 1, status: 'contracted' },
  ]);
  it('filters by company, status, counterparty, date and text', () => {
    expect(filterCommitments(items, { ...COMMIT_EMPTY, counterparties: ['Oracle'] }).map((c) => c.id)).toEqual(['1', '2']);
    expect(filterCommitments(items, { ...COMMIT_EMPTY, statuses: ['contracted'], companies: ['openai'] }).map((c) => c.id)).toEqual(['2']);
    expect(filterCommitments(items, { ...COMMIT_EMPTY, date: { mode: 'after', from: '2025-09-01' } }).map((c) => c.id)).toEqual(['2', '3']);
    expect(filterCommitments(items, { ...COMMIT_EMPTY, q: 'softbank' }).map((c) => c.id)).toEqual(['1']);
  });
  it('drops deals with no $ figure once a size range is set', () => {
    expect(filterCommitments(items, { ...COMMIT_EMPTY, size: { min: 0 } }).map((c) => c.id)).toEqual(['1', '2']);
    expect(filterCommitments(items, { ...COMMIT_EMPTY, size: { max: 400 } }).map((c) => c.id)).toEqual(['2']);
  });
});
