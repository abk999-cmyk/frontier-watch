import { describe, expect, it } from 'vitest';
import { classify, fallbackTitle, monogram, parseUrl, urlKey, urlsIn } from './classify.ts';

describe('urlsIn', () => {
  it('pulls URLs out of prose and trims trailing punctuation', () => {
    expect(urlsIn('See https://a.com/x. Also (https://b.org/y), and https://c.io/z_(1).')).toEqual(['https://a.com/x', 'https://b.org/y', 'https://c.io/z_(1)']);
  });
});

describe('urlKey', () => {
  it('merges scheme, www and trailing-slash variants but keeps query and hash', () => {
    const k = (u: string) => urlKey(parseUrl(u)!);
    expect(k('http://www.openai.com/index/gpt-4/')).toBe(k('https://openai.com/index/gpt-4'));
    expect(k('https://ai-2040.com/#2027')).not.toBe(k('https://ai-2040.com/#2028'));
    expect(k('https://nytimes.com./a')).toBe(k('https://nytimes.com/a'));
  });
});

describe('classify', () => {
  it.each([
    ['https://www.sec.gov/Archives/edgar/data/789019/x-index.htm', 'filing'],
    ['https://www.microsoft.com/en-us/investor/events/fy-2024/earnings-fy-2024-q2', 'filing'],
    ['https://arxiv.org/abs/2303.08774', 'paper'],
    ['https://www.tbench.ai/leaderboard/terminal-bench/2.0', 'leaderboard'],
    ['https://epoch.ai/benchmarks', 'leaderboard'],
    ['https://epoch.ai/data/benchmark_data.zip', 'dataset'],
    ['https://raw.githubusercontent.com/droodman/inference-cost/main/x.csv', 'dataset'],
    ['https://www.metaculus.com/questions/6592/', 'forecast'],
    ['https://api.manifold.markets/v0/market/SIIqNAUdLI', 'dataset'],
    ['https://en.wikipedia.org/wiki/GPT-4', 'wiki'],
    ['https://www.reuters.com/technology/x', 'news'],
    ['https://x.com/gdb/status/1', 'blog'],
    ['https://www-cdn.anthropic.com/abc.pdf', 'lab'],
    ['https://storage.googleapis.com/deepmind-media/Model-Cards/x.pdf', 'lab'],
    ['https://youtu.be/abc', 'other'],
  ])('%s → %s', (u, k) => expect(classify(u)).toBe(k));

  it('uses the hint only when the URL is unrecognised', () => {
    expect(classify('https://example.org/thing', 'leaderboard')).toBe('leaderboard');
    expect(classify('https://arxiv.org/abs/1', 'leaderboard')).toBe('paper');
  });
});

describe('fallbackTitle', () => {
  it('builds readable labels from well-known URL shapes', () => {
    expect(fallbackTitle('https://arxiv.org/abs/2303.08774v2')).toBe('arXiv:2303.08774');
    expect(fallbackTitle('https://x.com/gdb/status/19')).toBe('Post by @gdb on X');
    expect(fallbackTitle('https://github.com/droodman/inference-cost')).toBe('GitHub · droodman/inference-cost');
    expect(fallbackTitle('https://newsletter.semianalysis.com/p/gpt-4-architecture-infrastructure')).toBe('SemiAnalysis · GPT 4 architecture infrastructure');
    expect(fallbackTitle('https://epoch.ai/data/ai-chip-sales')).toBe('Epoch AI · AI chip sales');
    expect(fallbackTitle('https://www.govtrack.us/congress/bills/119/s1792')).toBe('GovTrack · bills 119 s1792');
    expect(fallbackTitle('https://ourworldindata.org/grapher/life-expectancy.csv')).toBe('Our World in Data · Life expectancy (CSV)');
  });
});

describe('monogram', () => {
  it('takes two letters from the registrable label', () => {
    expect(monogram('openai.com')).toBe('OP');
    expect(monogram('ai-2027.com')).toBe('A2');
    expect(monogram('bbc.co.uk')).toBe('BB');
  });
});
