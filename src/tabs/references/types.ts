/**
 * Shape of public/data/references.json (written by scripts/build-references.ts) plus the
 * display metadata the References tab needs. Pure: no DOM, safe to import from scripts.
 */

export const SECTIONS = ['Countdown', 'Benchmarks', 'Charts Lab', 'Timelines', 'Registry'] as const;
export type Section = (typeof SECTIONS)[number];

export const KINDS = ['lab', 'paper', 'leaderboard', 'dataset', 'news', 'filing', 'forecast', 'wiki', 'blog', 'other'] as const;
export type Kind = (typeof KINDS)[number];

export type Origin = 'fetched' | 'curated';

export interface Usage {
  section: Section;
  /** Where the URL was found: `scores/openai.yaml` (curated), `scores.json` / `alan.json` (fetched bundles), `scripts/fetch/*.ts`. */
  file: string;
  context: string;
  /** Rows folded into this usage (only set when > 1, e.g. Epoch rows collapsed per benchmark). */
  n?: number;
}

export interface Ref {
  url: string;
  host: string;
  title: string;
  kind: Kind;
  usedIn: Usage[];
  /** Total citations: every row, field or link that points here. */
  count: number;
  origins: Origin[];
  /** Set when many URLs were collapsed into this one entry (e.g. thousands of Epoch log-viewer links). */
  grouped?: number;
}

export interface FeedEndpoint {
  label: string;
  url: string;
  format: string;
  /** What this endpoint feeds, one line per dashboard module. */
  powers: { section: Section; what: string }[];
}

export interface Feed {
  id: string;
  name: string;
  org: string;
  homepage: string;
  license: string;
  licenseUrl?: string;
  fetcher: string;
  sections: Section[];
  lastFetched?: string;
  note?: string;
  endpoints: FeedEndpoint[];
}

export interface Citation {
  id: string;
  source: string;
  text: string;
  url: string;
  license: string;
}

export interface RefsStats {
  total: number;
  hosts: number;
  citations: number;
  byKind: Record<Kind, number>;
  bySection: Record<Section, number>;
  byOrigin: { fetched: number; curated: number; both: number };
  byHost: { host: string; refs: number; count: number }[];
  files: { file: string; refs: number }[];
  scoreRows: { independent: number; lab: number; epoch: number; curated: number };
  skipped: number;
}

export interface RefsData {
  generatedAt: string;
  feeds: Feed[];
  citations: Citation[];
  refs: Ref[];
  stats: RefsStats;
}

/** Display labels + a neutral glyph per kind (identity never by colour alone). */
export const KIND_META: Record<Kind, { label: string; short: string; glyph: string; hint: string }> = {
  lab: { label: 'Lab post / model card', short: 'Lab', glyph: '◆', hint: 'Announcements, model cards and system cards from labs and companies' },
  paper: { label: 'Paper', short: 'Paper', glyph: '¶', hint: 'arXiv, journals, DOIs and academic project pages' },
  leaderboard: { label: 'Leaderboard', short: 'Leaderboard', glyph: '▲', hint: 'Benchmark sites and independent eval leaderboards' },
  dataset: { label: 'Dataset / API', short: 'Data', glyph: '▦', hint: 'CSV, ZIP, sheets, repos, APIs and eval logs' },
  news: { label: 'News', short: 'News', glyph: '◉', hint: 'Press coverage and wire reports' },
  filing: { label: 'Filing / IR', short: 'Filing', glyph: '§', hint: 'SEC filings and investor-relations pages' },
  forecast: { label: 'Forecast', short: 'Forecast', glyph: '◔', hint: 'Prediction markets, forecasting platforms and scenario sites' },
  wiki: { label: 'Wiki', short: 'Wiki', glyph: 'W', hint: 'Wikipedia and Wikimedia' },
  blog: { label: 'Blog / social', short: 'Blog', glyph: '✎', hint: 'Newsletters, personal blogs and social posts' },
  other: { label: 'Other', short: 'Other', glyph: '·', hint: 'Video, government pages, archives and everything else' },
};

/** Which dashboard tab each section lives on (for "go to tab" links). */
export const SECTION_TAB: Record<Section, 'alan' | 'benchmarks' | 'charts' | 'timelines'> = {
  Countdown: 'alan',
  Benchmarks: 'benchmarks',
  'Charts Lab': 'charts',
  Timelines: 'timelines',
  Registry: 'benchmarks',
};

export const SECTION_HINT: Record<Section, string> = {
  Countdown: 'AGI countdown + ASI checklist (LifeArchitect.ai)',
  Benchmarks: 'Score matrix, benchmark pages, scaling vectors',
  'Charts Lab': 'Breakthroughs, capex, commitments, LEV, cost curves',
  Timelines: 'AI 2027 + AI 2040 grading, forecast drift',
  Registry: 'Model registry (release dates, compute, sources)',
};
