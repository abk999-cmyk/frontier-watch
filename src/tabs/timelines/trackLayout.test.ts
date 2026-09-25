import { describe, expect, it } from 'vitest';
import { dodgeOnRail, NODE_R } from './trackLayout.ts';

const MIN = NODE_R * 2 + 3;

describe('dodgeOnRail', () => {
  it('leaves well-separated nodes at their true x', () => {
    const nodes = [{ ex: 100 }, { ex: 200 }, { ex: 300 }];
    dodgeOnRail(nodes);
    expect(nodes.map((n) => n.ex)).toEqual([100, 200, 300]);
  });

  it('spreads coincident nodes sideways, centred on their mean, keeping the minimum gap', () => {
    const nodes = [{ ex: 500 }, { ex: 501 }, { ex: 502 }];
    dodgeOnRail(nodes);
    const xs = nodes.map((n) => n.ex!).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(MIN - 1e-9);
    expect((xs[0] + xs[2]) / 2).toBeCloseTo(501, 6);
  });

  it('never lets neighbouring clusters overlap', () => {
    const nodes = [{ ex: 100 }, { ex: 101 }, { ex: 112 }, { ex: 113 }];
    dodgeOnRail(nodes);
    const xs = nodes.map((n) => n.ex!).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(MIN - 1e-9);
  });
});
