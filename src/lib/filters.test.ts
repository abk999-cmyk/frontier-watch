import { describe, expect, it } from 'vitest';
import { addDays, addMonths, countBy, highlightParts, inRange, matchAny, matchDate, monthGrid, summarizeDate, textMatch } from './filters.ts';

describe('matchDate', () => {
  it('handles every mode inclusively', () => {
    expect(matchDate('2025-05-01', { mode: 'any' })).toBe(true);
    expect(matchDate('2025-05-01', { mode: 'before', to: '2025-05-01' })).toBe(true);
    expect(matchDate('2025-05-02', { mode: 'before', to: '2025-05-01' })).toBe(false);
    expect(matchDate('2025-05-01', { mode: 'after', from: '2025-05-01' })).toBe(true);
    expect(matchDate('2025-04-30', { mode: 'after', from: '2025-05-01' })).toBe(false);
    expect(matchDate('2025-06-15', { mode: 'between', from: '2025-06-01', to: '2025-06-30' })).toBe(true);
    expect(matchDate('2025-07-01', { mode: 'between', from: '2025-06-01', to: '2025-06-30' })).toBe(false);
    expect(matchDate(undefined, { mode: 'after', from: '2025-01-01' })).toBe(false);
  });
  it('summarises', () => {
    expect(summarizeDate({ mode: 'any' })).toBe('Any time');
    expect(summarizeDate({ mode: 'before', to: '2025-03-04' })).toBe('Before Mar 4, 2025');
    expect(summarizeDate({ mode: 'between', from: '2024-01-01', to: '2024-12-31' })).toBe('Jan 1, 2024 – Dec 31, 2024');
  });
});

describe('predicates', () => {
  it('ranges, sets, text', () => {
    expect(inRange(5, {})).toBe(true);
    expect(inRange(5, { min: 6 })).toBe(false);
    expect(inRange(undefined, { max: 3 })).toBe(false);
    expect(matchAny('a', [])).toBe(true);
    expect(matchAny(['a', 'b'], ['b'])).toBe(true);
    expect(matchAny(undefined, ['b'])).toBe(false);
    expect(textMatch('OpenAI GPT-6 Astra solves', 'astra openai')).toBe(true);
    expect(textMatch('OpenAI GPT-6 Astra solves', 'astra claude')).toBe(false);
  });
  it('highlights and counts', () => {
    expect(highlightParts('GPT-6 Astra wins', 'astra')).toEqual([
      { t: 'GPT-6 ', hit: false },
      { t: 'Astra', hit: true },
      { t: ' wins', hit: false },
    ]);
    expect(countBy([{ t: ['x', 'y'] }, { t: ['x'] }], (i) => i.t).get('x')).toBe(2);
  });
});

describe('calendar helpers', () => {
  it('builds Monday-first month grids', () => {
    const g = monthGrid(2026, 8); // Sep 2026 starts on a Tuesday
    expect(g[0]).toBeNull();
    expect(g[1]).toBe('2026-09-01');
    expect(g.length % 7).toBe(0);
    expect(g.filter(Boolean).length).toBe(30);
  });
  it('adds months and days', () => {
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
    expect(addMonths('2026-11-01', 3)).toBe('2027-02-01');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});
