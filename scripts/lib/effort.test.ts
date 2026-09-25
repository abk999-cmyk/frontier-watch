import { describe, expect, it } from 'vitest';
import { looseKey, normEffort, splitEpochVersion } from './effort.ts';

describe('splitEpochVersion', () => {
  it('splits effort suffixes', () => {
    expect(splitEpochVersion('gpt-6-astra_max')).toEqual({ base: 'gpt-6-astra', effort: 'max' });
    expect(splitEpochVersion('claude-fable-5-1_xhigh')).toEqual({ base: 'claude-fable-5-1', effort: 'xhigh' });
    expect(splitEpochVersion('gpt-5.4-2026-03-05_unknown')).toEqual({ base: 'gpt-5.4-2026-03-05', effort: 'unknown' });
  });
  it('maps pro-mode suffixes to promax', () => {
    expect(splitEpochVersion('gpt-5.6-sol_prounknown').effort).toBe('promax');
    expect(splitEpochVersion('gpt-5.6-sol_proxhigh')).toEqual({ base: 'gpt-5.6-sol', effort: 'promax' });
  });
  it('handles token budgets and bare names', () => {
    expect(splitEpochVersion('claude-opus-4-6_120K')).toEqual({ base: 'claude-opus-4-6', budget: '120K' });
    expect(splitEpochVersion('gemini-3.1-pro-preview')).toEqual({ base: 'gemini-3.1-pro-preview' });
    expect(splitEpochVersion('glm-5.2_max').base).toBe('glm-5.2');
  });
});

describe('normEffort / looseKey', () => {
  it('normalises labels', () => {
    expect(normEffort('XHigh')).toBe('xhigh');
    expect(normEffort('Max')).toBe('max');
    expect(normEffort('disabled')).toBe('none');
    expect(normEffort('thinking')).toBe('unknown');
    expect(normEffort('')).toBeUndefined();
  });
  it('loosely keys names', () => {
    expect(looseKey('claude-fable-5.1')).toBe(looseKey('claude_fable_5_1'));
    expect(looseKey('gpt-5.4-pro-2026-03-05')).toBe('gpt-5-4-pro');
  });
});
