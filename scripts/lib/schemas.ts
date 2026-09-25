import { z } from 'zod';

/** Accepts YYYY-MM-DD, YYYY-MM or YYYY and normalises to YYYY-MM-DD. */
export const isoDate = z.preprocess((v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') v = String(v);
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  return s;
}, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'));

const optStr = z.string().nullish();
const url = z.string().min(4);

export const LabIdZ = z.enum(['openai', 'anthropic', 'google', 'xai', 'deepseek', 'alibaba', 'moonshot', 'zhipu']);

export const ModelZ = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.\-]*$/),
  name: z.string(),
  lab: LabIdZ,
  released: isoDate,
  datePrecision: z.enum(['day', 'month']).nullish(),
  tier: z.enum(['flagship', 'variant']).default('flagship'),
  variantOf: optStr,
  status: z.enum(['released', 'announced', 'restricted']).default('released'),
  pretrain: z.boolean().nullish(),
  pretrainNote: optStr,
  scalingVector: optStr,
  trainingFlop: z.coerce.number().nullish(),
  params: z.union([z.string(), z.number()]).transform(String).nullish(),
  openWeights: z.boolean().nullish(),
  epochIds: z.array(z.string()).nullish(),
  eciNames: z.array(z.string()).nullish(),
  sources: z.array(z.string()).nullish(),
});
export type ModelEntry = z.infer<typeof ModelZ>;

export const ScalingVectorZ = z.object({
  id: z.string(),
  name: z.string(),
  introducedBy: z.string(),
  date: isoDate,
  summary: z.string(),
  url: optStr,
});

const EpochMapZ = z.object({
  file: z.string(),
  score: z.string(),
  scale: z.number().default(1),
  provenance: z.enum(['independent', 'lab']).default('independent'),
  tools: z.boolean().optional(),
  where: z.record(z.string(), z.string()).optional(),
  extra: z.record(z.string(), z.string()).optional(),
});
export type EpochMap = z.infer<typeof EpochMapZ>;

export const BenchmarkZ = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.\-]*$/),
  name: z.string(),
  short: z.string(),
  group: z.enum(['hle', 'swe', 'agentic', 'science', 'math', 'bio', 'index']),
  version: z.union([z.string(), z.number()]).transform(String).nullish(),
  unit: z.enum(['pct', 'minutes', 'usd', 'points', 'index']).default('pct'),
  higherIsBetter: z.boolean().default(true),
  ceiling: z.number().nullish(),
  saturatedOn: isoDate.nullish(),
  released: isoDate.nullish(),
  url: optStr,
  description: optStr,
  epoch: EpochMapZ.optional(),
});
export type BenchmarkEntry = z.infer<typeof BenchmarkZ>;

export const ScoreZ = z.object({
  model: z.string(),
  benchmark: z.string(),
  value: z.coerce.number(),
  provenance: z.enum(['independent', 'lab']).default('lab'),
  tools: z.boolean().nullish(),
  effort: z.string().nullish(),
  setting: z.union([z.string(), z.number()]).transform(String).nullish(),
  date: isoDate.nullish(),
  source: optStr,
  url: optStr,
});
export type ScoreEntry = z.infer<typeof ScoreZ>;

export const ScoresFileZ = z.object({
  newBenchmarks: z.array(z.unknown()).nullish(),
  scores: z.array(z.unknown()),
});

export const BreakthroughZ = z.object({
  id: z.string(),
  date: isoDate,
  title: z.string(),
  domain: z.enum(['math', 'science']),
  field: optStr,
  system: optStr,
  org: optStr,
  significance: z.coerce.number().min(0).max(5),
  verification: z.enum(['formal-proof', 'peer-reviewed', 'expert-endorsed', 'claimed', 'disputed']),
  autonomy: z.enum(['tool', 'collaborative', 'autonomous']).nullish(),
  summary: optStr,
  url: url,
  model: optStr,
  modelId: optStr,
  tags: z.array(z.string()).nullish(),
  problem: optStr,
  alanRef: z.coerce.number().nullish(),
}).passthrough();
export type Breakthrough = z.infer<typeof BreakthroughZ>;

export const MilestoneZ = z.object({
  id: z.string(),
  date: isoDate,
  datePrecision: optStr,
  branch: z.enum(['shared', 'race', 'slowdown']).default('shared'),
  title: z.string(),
  summary: optStr,
  claims: z.array(z.object({ metric: z.string(), value: z.unknown().optional(), note: optStr }).passthrough()).nullish(),
  status: z.enum(['hit', 'partial', 'not-yet', 'missed', 'n/a']).default('n/a'),
  statusNote: optStr,
  evidenceUrl: optStr,
  proxy: optStr,
}).passthrough();

export const ProxyZ = z.object({
  id: z.string(),
  name: z.string(),
  metric: optStr,
  scenarioDate: isoDate,
  scenarioRef: optStr,
  scenarioValue: z.unknown().optional(),
  realityDate: isoDate.nullish(),
  realityRef: optStr,
  status: z.enum(['reached', 'not-yet']),
  projectedDate: isoDate.nullish(),
  projectionNote: optStr,
  weight: z.coerce.number().default(1),
  note: optStr,
  sources: z.array(z.string()).nullish(),
}).passthrough();

export const ForecastUpdateZ = z.object({
  forecaster: z.string(),
  published: isoDate,
  milestone: z.string(),
  median: isoDate,
  note: optStr,
  url: optStr,
});

export const CapexQuarterZ = z.object({
  company: z.string(),
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/),
  capex: z.coerce.number(),
  financeLeases: z.coerce.number().nullish(),
  note: optStr,
  url: optStr,
}).passthrough();

export const CommitmentZ = z.object({
  id: z.string(),
  date: isoDate,
  company: z.string(),
  counterparties: z.array(z.string()).nullish(),
  title: z.string(),
  usdBillions: z.coerce.number().nullish(),
  gigawatts: z.coerce.number().nullish(),
  horizon: optStr,
  status: z.enum(['announced', 'contracted', 'revised', 'cancelled']).default('announced'),
  supersededBy: optStr,
  note: optStr,
  url: optStr,
});
