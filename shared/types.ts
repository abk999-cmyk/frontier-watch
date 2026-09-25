// Data contract between the build pipeline (scripts/) and the app (src/).
// Every JSON file in public/data/ conforms to one of these shapes.

export type LabId = 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek' | 'alibaba' | 'moonshot' | 'zhipu';
export type LabGroup = 'openai' | 'anthropic' | 'google' | 'xai' | 'china' | 'other';
export type Effort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'promax' | 'unknown';
export const EFFORT_ORDER: Effort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'promax'];

export type BenchGroup = 'hle' | 'swe' | 'agentic' | 'science' | 'math' | 'bio' | 'index';
export const BENCH_GROUP_ORDER: BenchGroup[] = ['hle', 'swe', 'agentic', 'science', 'math', 'bio', 'index'];
export type Unit = 'pct' | 'minutes' | 'usd' | 'points' | 'index';
export type Provenance = 'independent' | 'lab';

export interface Model {
  id: string;
  name: string;
  lab: LabId;
  labGroup: LabGroup;
  released: string;
  datePrecision?: 'day' | 'month';
  tier: 'flagship' | 'variant';
  variantOf?: string | null;
  status: 'released' | 'announced' | 'restricted';
  pretrain?: boolean | null;
  pretrainNote?: string | null;
  scalingVector?: string | null;
  trainingFlop?: number | null;
  params?: string | null;
  openWeights?: boolean | null;
  eci?: { value: number; low: number; high: number } | null;
  sources?: string[];
}

export interface ScalingVector {
  id: string;
  name: string;
  introducedBy: string;
  date: string;
  summary: string;
  url?: string | null;
}

export interface Benchmark {
  id: string;
  name: string;
  short: string;
  group: BenchGroup;
  version?: string | null;
  unit: Unit;
  higherIsBetter: boolean;
  ceiling: number | null;
  saturatedOn?: string | null;
  released?: string | null;
  url?: string | null;
  description?: string | null;
}

/** One score observation. Compact keys keep scores.json small. */
export interface ScoreRecord {
  m: string; // model id
  b: string; // benchmark id
  v: number; // value in the benchmark's unit
  prov: Provenance;
  src: 'epoch' | 'curated';
  tools?: boolean;
  effort?: Effort;
  setting?: string;
  date?: string;
  source?: string;
  url?: string;
  x?: { costUsd?: number; outputTokens?: number; costPerTask?: number; tokensPerTask?: number; harness?: string; ciLow?: number; ciHigh?: number };
}

export interface CoreData {
  generatedAt: string;
  models: Model[];
  benchmarks: Benchmark[];
  scalingVectors: ScalingVector[];
}

export interface ScoresData {
  records: ScoreRecord[];
}

/** Any Epoch model (not only registry models), for trend charts. */
export interface EciPoint {
  name: string;
  modelId?: string;
  org: string;
  labGroup: LabGroup;
  date: string;
  eci: number;
  low: number;
  high: number;
  open: boolean;
  flop?: number;
}

export interface MetrPoint {
  name: string;
  modelId?: string;
  labGroup: LabGroup;
  date: string;
  p50: number; // minutes
  p50Low?: number;
  p50High?: number;
  p80?: number;
  sota?: boolean;
}

/** Score-vs-effort / tokens / cost observations. */
export interface EffortPoint {
  base: string; // epoch base model string
  name: string; // display name
  modelId?: string;
  labGroup: LabGroup;
  date?: string; // model release date
  benchmark: string; // benchmark id
  effort: Effort | string;
  score: number; // pct
  costUsd?: number; // per task
  tokens?: number; // output tokens per task
}

export interface TrendsData {
  eci: EciPoint[];
  metr: MetrPoint[];
  effort: EffortPoint[];
  frontierByBenchmark: Record<string, { date: string; v: number; m: string }[]>;
}

export interface AgiData {
  value: number;
  lastUpdate: string;
  fetchedAt: string;
  history: { date: string; value: number; summary: string }[];
  log: { date: string; kind: 'pct' | 'info'; value?: number; title: string; summary: string; links: { label: string; url: string }[] }[];
}

export type AsiStatus = 'achieved' | 'partial' | 'none';
export interface AsiItem {
  id: number;
  phase: 1 | 2 | 3;
  label: string;
  keyword?: string;
  type: string;
  status: AsiStatus;
  lastUpdated?: string;
  links: string[];
  notes?: string;
}
export interface AsiData {
  fetchedAt: string;
  items: AsiItem[];
  /** status transitions for the replay scrubber */
  events: { date: string; ids: number[]; achieved: boolean }[];
  log: { date: string; ids: { id: number; status: AsiStatus }[]; title: string; summary: string; links: { label: string; url: string }[] }[];
  discoveries: { n: number; model: string; discovery: string; org: string; date: string; url?: string }[];
}

export interface AlanData {
  agi: AgiData;
  asi: AsiData;
}

export interface SnapshotMeta {
  source: string;
  fetchedAt: string;
  ok: boolean;
  note?: string;
}
