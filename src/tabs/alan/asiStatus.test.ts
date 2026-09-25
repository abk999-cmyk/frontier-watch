import { describe, expect, it } from 'vitest';
import type { AsiItem } from '../../../shared/types.ts';
import { asiScore, parseLoose, replayMonths, statusesAt } from './asiStatus.ts';

const item = (id: number, status: AsiItem['status'], lastUpdated?: string): AsiItem => ({ id, phase: 1, label: `#${id}`, type: 'x', status, links: [], lastUpdated });

describe('asi status replay', () => {
  const items = [item(1, 'achieved'), item(2, 'partial', '2024'), item(3, 'none'), item(4, 'partial')];
  const events = [
    { date: '2025-03-01', ids: [1], achieved: false },
    { date: '2026-05-01', ids: [1], achieved: true },
    { date: '2025-06-01', ids: [4], achieved: false },
    { date: '2025-07-01', ids: [4], achieved: true }, // stale "achieved" must be capped at today's partial
  ];

  it('returns today status when asOf is null', () => {
    expect([...statusesAt(items, events, null).values()]).toEqual(['achieved', 'partial', 'none', 'partial']);
  });

  it('reconstructs history from events and lastUpdated', () => {
    const s = statusesAt(items, events, '2025-04-01');
    expect(s.get(1)).toBe('partial');
    expect(s.get(2)).toBe('partial'); // lastUpdated 2024
    expect(s.get(3)).toBe('none');
    expect(s.get(4)).toBe('none');
  });

  it('caps reconstructed status at today', () => {
    expect(statusesAt(items, events, '2025-08-01').get(4)).toBe('partial');
    expect(statusesAt(items, events, '2026-06-01').get(1)).toBe('achieved');
  });

  it('scores achieved=1, partial=0.5', () => {
    expect(asiScore(statusesAt(items, events, null))).toBeCloseTo(((1 + 0.5 + 0 + 0.5) / 4) * 100);
  });

  it('parses loose dates and builds month ranges', () => {
    expect(parseLoose('May/2026')).toBe('2026-05-01');
    expect(parseLoose('2025')).toBe('2025-01-01');
    expect(parseLoose('')).toBeNull();
    expect(replayMonths(events, '2025-05-01')).toEqual(['2025-03-01', '2025-04-01', '2025-05-01']);
  });
});
