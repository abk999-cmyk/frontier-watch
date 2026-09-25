/**
 * Merge fetched sources (data/raw) + hand-curated YAML (data/curated) into the
 * validated JSON bundles the app reads (public/data), plus coverage reports.
 *
 *   npm run build:data            → builds, prints warnings
 *   npm run build:data -- --strict → exits non-zero on any validation issue
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { CURATED, OUT, RAW, REPORTS } from './lib/paths.ts';
import { listFiles, readCsv, readJson, readYaml, writeJson } from './lib/io.ts';
import { looseKey, normEffort, splitEpochVersion } from './lib/effort.ts';
import { LAB_GROUP, orgToGroup } from './lib/labs.ts';
import {
  BenchmarkZ, BreakthroughZ, CapexQuarterZ, CommitmentZ, ForecastUpdateZ, MilestoneZ, ModelZ, ProxyZ,
  ScalingVectorZ, ScoreZ, ScoresFileZ, type BenchmarkEntry, type ModelEntry,
} from './lib/schemas.ts';
import type {
  AlanData, Benchmark, CoreData, EciPoint, EffortPoint, LabGroup, MetrPoint, Model, ScoreRecord, TrendsData,
} from '../shared/types.ts';

const strict = process.argv.includes('--strict');
const issues: { file: string; where: string; message: string }[] = [];
const warn = (file: string, where: string, message: string) => issues.push({ file, where, message });

/** Validate each list entry independently so one bad row never drops a whole file. */
function parseList<T>(schema: z.ZodType<T>, raw: unknown, file: string): T[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    warn(file, '(root)', 'expected a list');
    return [];
  }
  const out: T[] = [];
  raw.forEach((row, i) => {
    const r = schema.safeParse(row);
    if (r.success) out.push(r.data);
    else warn(file, `#${i} ${(row as any)?.id ?? (row as any)?.model ?? ''}`, r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '));
  });
  return out;
}

const cur = (f: string) => path.join(CURATED, f);
const num = (s: string | undefined) => {
  if (s == null || s === '') return undefined;
  const n = Number(String(s).replace(/[$,%]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};
const day = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined);

// ── 1. Registry ─────────────────────────────────────────────────────────────
const modelEntries = parseList(ModelZ, readYaml(cur('models.yaml')), 'models.yaml');
const modelIds = new Set(modelEntries.map((m) => m.id));
const scalingVectors = parseList(ScalingVectorZ, readYaml(cur('scaling-vectors.yaml')), 'scaling-vectors.yaml');

let benchEntries: BenchmarkEntry[] = parseList(BenchmarkZ, readYaml(cur('benchmarks.yaml')), 'benchmarks.yaml');

// scores/*.yaml may declare newBenchmarks — merge them (first declaration wins).
const scoreFiles = listFiles(cur('scores'), '.yaml');
const scoreFileData = scoreFiles.map((f) => {
  const raw = readYaml(path.join(CURATED, 'scores', f));
  const parsed = ScoresFileZ.safeParse(raw);
  if (!parsed.success) {
    warn(`scores/${f}`, '(root)', 'expected {scores: [...]}');
    return { f, newBenchmarks: [] as unknown[], scores: [] as unknown[] };
  }
  return { f, newBenchmarks: parsed.data.newBenchmarks ?? [], scores: parsed.data.scores };
});
const benchIds = new Set(benchEntries.map((b) => b.id));
for (const { f, newBenchmarks } of scoreFileData) {
  for (const b of parseList(BenchmarkZ, newBenchmarks, `scores/${f} newBenchmarks`)) {
    if (benchIds.has(b.id)) continue;
    benchIds.add(b.id);
    benchEntries.push(b);
  }
}

// ── 2. Epoch base-string → model id matching ────────────────────────────────
const epochToModel = new Map<string, string>();
const looseToModel = new Map<string, string>();
for (const m of modelEntries) {
  for (const e of m.epochIds ?? []) epochToModel.set(e, m.id);
  looseToModel.set(looseKey(m.id), m.id);
}
function matchModel(base: string): string | undefined {
  return epochToModel.get(base) ?? looseToModel.get(looseKey(base));
}

// ── 3. Scores: Epoch (independent) ──────────────────────────────────────────
const records: ScoreRecord[] = [];
const unmatched = new Map<string, { files: Set<string>; org: string }>();
const EPOCH = path.join(RAW, 'epoch');
if (!existsSync(EPOCH)) warn('data/raw/epoch', '(root)', 'missing — run `npm run fetch` first');

for (const b of benchEntries) {
  const map = b.epoch;
  if (!map) continue;
  const rows = readCsv(path.join(EPOCH, map.file));
  if (!rows.length) {
    warn('benchmarks.yaml', b.id, `Epoch file ${map.file} empty or missing`);
    continue;
  }
  if (!(map.score in rows[0])) {
    warn('benchmarks.yaml', b.id, `score column "${map.score}" not in ${map.file}`);
    continue;
  }
  for (const row of rows) {
    if (map.where && !Object.entries(map.where).every(([c, sub]) => (row[c] ?? '').includes(sub))) continue;
    const version = (row['Model version'] ?? '').trim();
    const raw = num(row[map.score]);
    if (!version || raw === undefined) continue;
    const { base, effort } = splitEpochVersion(version);
    const modelId = matchModel(base);
    if (!modelId) {
      const u = unmatched.get(base) ?? { files: new Set<string>(), org: row['Organization'] ?? '' };
      u.files.add(map.file);
      unmatched.set(base, u);
      continue;
    }
    const x: ScoreRecord['x'] = {};
    const ex = map.extra ?? {};
    if (ex.costUsd) x.costUsd = num(row[ex.costUsd]);
    if (ex.outputTokens) x.outputTokens = num(row[ex.outputTokens]);
    if (ex.costPerTask) x.costPerTask = num(row[ex.costPerTask]);
    if (ex.harness && row[ex.harness]) x.harness = row[ex.harness];
    if (ex.ciLow) x.ciLow = num(row[ex.ciLow]);
    if (ex.ciHigh) x.ciHigh = num(row[ex.ciHigh]);
    const eff = effort ?? (ex.effort ? normEffort(row[ex.effort]) : undefined);
    records.push({
      m: modelId,
      b: b.id,
      v: +(raw * map.scale).toFixed(4),
      prov: map.provenance,
      src: 'epoch',
      tools: map.tools,
      effort: eff,
      date: day(row['Started at']) ?? day(row['Run date']) ?? day(row['Date added']) ?? day(row['Created']),
      source: 'Epoch AI Benchmarking Hub',
      url: row['Source link'] || row['Source Link'] || row['Log viewer'] || 'https://epoch.ai/benchmarks',
      x: Object.values(x).some((v) => v !== undefined) ? x : undefined,
    });
  }
}

// ── 4. Scores: curated (lab-reported + leaderboards) ────────────────────────
for (const { f, scores } of scoreFileData) {
  for (const s of parseList(ScoreZ, scores, `scores/${f}`)) {
    if (!modelIds.has(s.model)) {
      warn(`scores/${f}`, s.model, `unknown model id (benchmark ${s.benchmark})`);
      continue;
    }
    if (!benchIds.has(s.benchmark)) {
      warn(`scores/${f}`, s.benchmark, `unknown benchmark id (model ${s.model})`);
      continue;
    }
    records.push({
      m: s.model,
      b: s.benchmark,
      v: s.value,
      prov: s.provenance,
      src: 'curated',
      tools: s.tools ?? undefined,
      effort: normEffort(s.effort ?? undefined),
      setting: s.setting ?? undefined,
      date: s.date ?? undefined,
      source: s.source ?? undefined,
      url: s.url ?? undefined,
    });
  }
}

const benchById = new Map(benchEntries.map((b) => [b.id, b]));

// `tools` only means something where tool use is optional (HLE, science, math, bio: search / code
// execution). SWE and agentic benchmarks always run inside a tool harness, and labs label that
// inconsistently (spot-check 2026-09-24), so the flag is dropped there rather than shown as a split.
const INHERENT_TOOLS = new Set(['swe', 'agentic']);
for (const r of records) if (INHERENT_TOOLS.has(benchById.get(r.b)!.group)) delete r.tools;

// Sanity: pct values must sit in [0, 100].
for (const r of records) {
  const b = benchById.get(r.b)!;
  if (b.unit === 'pct' && (r.v < 0 || r.v > 100.0001)) warn('scores', `${r.m}/${r.b}`, `pct value out of range: ${r.v} (${r.src})`);
}

// ── 5. ECI (all Epoch models) + registry join ───────────────────────────────
const eciRows = readCsv(path.join(EPOCH, 'epoch_capabilities_index/eci_scores.csv'));
// Training compute by Epoch model group / display name, for the 3D compute axis.
const flopByName = new Map<string, number>();
for (const r of readCsv(path.join(EPOCH, 'model_metadata.csv'))) {
  const f = num(r['training_compute_flop']);
  if (!f) continue;
  for (const k of [r['model_group'], r['display_name']]) if (k && !(flopByName.get(k)! >= f)) flopByName.set(k, f);
}
const registryFlop = new Map(modelEntries.filter((m) => m.trainingFlop).map((m) => [m.id, m.trainingFlop!]));
const eciNameToModel = new Map<string, string>();
for (const m of modelEntries) for (const n of m.eciNames ?? []) eciNameToModel.set(n, m.id);
const eci: EciPoint[] = eciRows
  .map((r) => {
    const name = r['Display name'] || r['Model'];
    const versions = (r['model_versions'] ?? '').split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    const modelId =
      eciNameToModel.get(r['Model']) ??
      eciNameToModel.get(name) ??
      versions.map((v) => matchModel(splitEpochVersion(v).base)).find(Boolean) ??
      looseToModel.get(looseKey(name.replace(/^claude\s+/i, 'claude-')));
    return {
      name,
      modelId,
      org: r['Organization'],
      labGroup: orgToGroup(r['Organization'], r['Country (of organization)']),
      date: day(r['date']) ?? '',
      eci: num(r['eci']) ?? NaN,
      low: num(r['eci_ci_low']) ?? NaN,
      high: num(r['eci_ci_high']) ?? NaN,
      open: /open/i.test(r['Accessibility group'] ?? ''),
      flop: (modelId && registryFlop.get(modelId)) || flopByName.get(r['Model']) || flopByName.get(name) || undefined,
    } satisfies EciPoint;
  })
  .filter((p) => p.date && Number.isFinite(p.eci));
const eciByModel = new Map<string, EciPoint>();
for (const p of eci) if (p.modelId && (!eciByModel.has(p.modelId) || eciByModel.get(p.modelId)!.eci < p.eci)) eciByModel.set(p.modelId, p);
for (const [id, p] of eciByModel) records.push({ m: id, b: 'eci', v: p.eci, prov: 'independent', src: 'epoch', source: 'Epoch Capabilities Index', url: 'https://epoch.ai/eci', x: { ciLow: p.low, ciHigh: p.high } });

/** "claude-mythos-preview-early" → "Claude Mythos Preview Early" for models outside the registry. */
function prettify(base: string) {
  return base
    .replace(/-(\d{4}-\d{2}-\d{2}|\d{8})$/, '')
    .split('-')
    .map((w) => (/^(gpt|glm|o\d)$/i.test(w) ? w.toUpperCase().replace(/^O/, 'o') : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/^GPT /, 'GPT-');
}

// ── 6. METR time horizons (all models) ──────────────────────────────────────
const metrRows = readCsv(path.join(EPOCH, 'metr_time_horizons_external.csv'));
const metrBest = new Map<string, MetrPoint & { ver: string }>();
for (const r of metrRows) {
  const version = (r['Model version'] ?? '').trim();
  const p50 = num(r['Time horizon']);
  const date = day(r['Release date']);
  if (!version || p50 === undefined || !date) continue;
  const { base } = splitEpochVersion(version);
  const ver = r['METR version'] || '';
  const prev = metrBest.get(base);
  // Prefer the newest METR methodology version, then the higher estimate.
  if (prev && (prev.ver > ver || (prev.ver === ver && prev.p50 >= p50))) continue;
  const mid = matchModel(base);
  metrBest.set(base, {
    name: (mid && modelEntries.find((m) => m.id === mid)?.name) || r['Name'] || prettify(base),
    modelId: mid,
    labGroup: orgToGroup(r['Organization'], r['Country']),
    date,
    p50,
    p50Low: num(r['CI_low']),
    p50High: num(r['CI_high']),
    p80: num(r['Time Horizon (80%)']),
    ver,
  });
}
const metr: MetrPoint[] = [...metrBest.values()]
  .map(({ ver: _v, ...p }) => p)
  .sort((a, b) => a.date.localeCompare(b.date));
let best = 0;
for (const p of metr) if (p.p50 > best) { best = p.p50; p.sota = true; }

// ── 7. Effort / tokens / cost points (all models) ──────────────────────────
const nameFor = (base: string, row: Record<string, string>) => {
  const id = matchModel(base);
  return id ? modelEntries.find((m) => m.id === id)!.name : (row['Name'] || base).replace(/\s*\((?:[^)]*)\)\s*$/, '');
};
const effort: EffortPoint[] = [];
const EFFORT_SOURCES: { bench: string; file: string; score: string; scale: number; effortCol?: string; cost?: string; tokens?: string }[] = [
  { bench: 'gpqa-diamond', file: 'gpqa_diamond.csv', score: 'Best score (across scorers)', scale: 100 },
  { bench: 'frontiermath-t13-v2', file: 'frontiermath_tiers_1_3_v2.csv', score: 'Best score (across scorers)', scale: 100 },
  { bench: 'frontiermath-t4-v2', file: 'frontiermath_tier_4_v2.csv', score: 'Best score (across scorers)', scale: 100 },
  { bench: 'otis-mock-aime', file: 'otis_mock_aime_2024_2025.csv', score: 'Best score (across scorers)', scale: 100 },
  { bench: 'swe-bench-verified', file: 'swe_bench_verified.csv', score: 'Best score (across scorers)', scale: 100 },
  { bench: 'arc-agi-1', file: 'arc_agi_external.csv', score: 'Score', scale: 100, cost: 'Cost per task' },
  { bench: 'arc-agi-2', file: 'arc_agi_2_external.csv', score: 'Score', scale: 100, cost: 'Cost per task' },
  { bench: 'deepswe', file: 'deepswe_external.csv', score: 'Pass@1', scale: 100, effortCol: 'Reasoning effort', cost: 'Mean cost (USD)', tokens: 'Mean output tokens' },
  { bench: 'cursorbench', file: 'cursorbench_external.csv', score: 'Score', scale: 100, effortCol: 'Reasoning level', cost: 'Cost per task', tokens: 'Tokens per task' },
  { bench: 'proofbench', file: 'proofbench_external.csv', score: 'Accuracy', scale: 100, effortCol: 'Reasoning effort', cost: 'Cost per test (USD)' },
  { bench: 'osworld-2', file: 'osworld_2_external.csv', score: 'Binary accuracy', scale: 100, effortCol: 'Reasoning', cost: 'Estimated cost (USD)' },
];
for (const s of EFFORT_SOURCES) {
  for (const row of readCsv(path.join(EPOCH, s.file))) {
    const version = (row['Model version'] ?? '').trim();
    const score = num(row[s.score]);
    if (!version || score === undefined) continue;
    const split = splitEpochVersion(version);
    const eff = split.effort ?? (s.effortCol ? normEffort(row[s.effortCol]) : undefined) ?? (split.budget ? (split.budget as any) : undefined);
    const cost = s.cost ? num(row[s.cost]) : undefined;
    const tokens = s.tokens ? num(row[s.tokens]) : undefined;
    if (!eff && cost === undefined && tokens === undefined) continue;
    effort.push({
      base: split.base,
      name: nameFor(split.base, row),
      modelId: matchModel(split.base),
      labGroup: orgToGroup(row['Organization'], row['Country']),
      date: day(row['Release date']),
      benchmark: s.bench,
      effort: eff ?? 'unknown',
      score: +(score * s.scale).toFixed(3),
      costUsd: cost,
      tokens,
    });
  }
}

// ── 8. Frontier (best-so-far by model release date) per benchmark ─────────
const models: Model[] = modelEntries.map((m: ModelEntry) => ({
  id: m.id,
  name: m.name,
  lab: m.lab,
  labGroup: LAB_GROUP[m.lab],
  released: m.released,
  datePrecision: m.datePrecision ?? undefined,
  tier: m.tier,
  variantOf: m.variantOf ?? null,
  status: m.status,
  pretrain: m.pretrain ?? null,
  pretrainNote: m.pretrainNote ?? null,
  scalingVector: m.scalingVector ?? null,
  trainingFlop: m.trainingFlop ?? null,
  params: m.params ?? null,
  openWeights: m.openWeights ?? null,
  eci: eciByModel.has(m.id) ? { value: eciByModel.get(m.id)!.eci, low: eciByModel.get(m.id)!.low, high: eciByModel.get(m.id)!.high } : null,
  sources: m.sources ?? [],
}));
const released = new Map(models.map((m) => [m.id, m.released]));
const frontierByBenchmark: TrendsData['frontierByBenchmark'] = {};
for (const b of benchEntries) {
  const best = new Map<string, number>();
  for (const r of records) {
    if (r.b !== b.id) continue;
    const cur = best.get(r.m);
    const better = b.higherIsBetter ? r.v > (cur ?? -Infinity) : r.v < (cur ?? Infinity);
    if (better) best.set(r.m, r.v);
  }
  const pts = [...best.entries()].map(([m, v]) => ({ m, v, date: released.get(m)! })).sort((a, c) => a.date.localeCompare(c.date));
  const steps: { date: string; v: number; m: string }[] = [];
  for (const p of pts) {
    const last = steps.at(-1);
    if (!last || (b.higherIsBetter ? p.v > last.v : p.v < last.v)) steps.push(p);
  }
  if (steps.length) frontierByBenchmark[b.id] = steps;
}

// Registry sanity checks.
for (const m of models) {
  if (m.variantOf && !modelIds.has(m.variantOf)) warn('models.yaml', m.id, `variantOf "${m.variantOf}" is not a model id`);
  if (m.scalingVector && !scalingVectors.some((s) => s.id === m.scalingVector)) warn('models.yaml', m.id, `scalingVector "${m.scalingVector}" not defined in scaling-vectors.yaml`);
}

// ── 9. Alan (fetched) ───────────────────────────────────────────────────────
const alan = readJson<AlanData>(path.join(RAW, 'alan.json'));
if (!alan) warn('data/raw/alan.json', '(root)', 'missing — run `npm run fetch`');

// ── 10. Charts + timelines (curated) ────────────────────────────────────────
const breakthroughs = parseList(BreakthroughZ, readYaml(cur('breakthroughs.yaml')), 'breakthroughs.yaml');
const capexRaw = readYaml<any>(cur('capex.yaml'));
const capex = {
  ...Object.fromEntries(Object.entries(capexRaw ?? {}).filter(([k]) => !['quarters', 'guidance'].includes(k))),
  definition: capexRaw?.definition ?? null,
  fiscalMapping: capexRaw?.fiscalMapping ?? null,
  quarters: parseList(CapexQuarterZ, capexRaw?.quarters, 'capex.yaml'),
  guidance: Array.isArray(capexRaw?.guidance) ? capexRaw.guidance : [],
};
const commitments = parseList(CommitmentZ, readYaml(cur('spending-commitments.yaml')), 'spending-commitments.yaml');
const lev = readYaml<any>(cur('lev.yaml')) ?? null;
const survival = readCsv(cur('survival-curves.csv'));
const lifeExpectancy = readJson<any>(path.join(RAW, 'owid-life-expectancy.json')) ?? null;
const inferenceCost = readJson<any>(path.join(RAW, 'inference-cost.json')) ?? null;

const ai2027raw = readYaml<any>(cur('ai2027.yaml'));
const ai2027 = ai2027raw
  ? { ...Object.fromEntries(Object.entries(ai2027raw).filter(([k]) => k !== 'milestones')), milestones: parseList(MilestoneZ, ai2027raw.milestones, 'ai2027.yaml') }
  : null;
const proxies = parseList(ProxyZ, readYaml(cur('ai2027-proxies.yaml')), 'ai2027-proxies.yaml');
const updates = parseList(ForecastUpdateZ, readYaml(cur('ai2027-updates.yaml')), 'ai2027-updates.yaml');
const ai2040 = readYaml<any>(cur('ai2040.yaml')) ?? null;

// ── 11. Write bundles ───────────────────────────────────────────────────────
const generatedAt = new Date().toISOString();
const benchmarks: Benchmark[] = benchEntries.map(({ epoch: _e, ...b }) => ({
  ...b,
  version: b.version ?? null,
  ceiling: b.ceiling ?? (b.unit === 'pct' ? 100 : null),
}));
const core: CoreData = { generatedAt, models, benchmarks, scalingVectors };
writeJson(path.join(OUT, 'core.json'), core);
writeJson(path.join(OUT, 'scores.json'), { records });
writeJson(path.join(OUT, 'trends.json'), { eci, metr, effort, frontierByBenchmark } satisfies TrendsData);
if (alan) writeJson(path.join(OUT, 'alan.json'), alan);
writeJson(path.join(OUT, 'charts.json'), { breakthroughs, capex, commitments, lev, survival, lifeExpectancy, inferenceCost });
writeJson(path.join(OUT, 'timelines.json'), { ai2027, proxies, updates, ai2040 });

// Coverage report: filled cells per benchmark / per model.
const cell = new Set(records.map((r) => `${r.m}|${r.b}`));
const perBench = Object.fromEntries(benchmarks.map((b) => [b.id, models.filter((m) => cell.has(`${m.id}|${b.id}`)).length]));
const perModel = Object.fromEntries(models.map((m) => [m.id, benchmarks.filter((b) => cell.has(`${m.id}|${b.id}`)).length]));
writeJson(path.join(REPORTS, 'coverage.json'), { generatedAt, cells: cell.size, records: records.length, perBench, perModel }, true);
writeJson(
  path.join(REPORTS, 'unmatched.json'),
  [...unmatched.entries()].map(([base, u]) => ({ base, org: u.org, files: [...u.files] })).sort((a, b) => a.org.localeCompare(b.org) || a.base.localeCompare(b.base)),
  true,
);
writeJson(path.join(REPORTS, 'validation.json'), issues, true);

const groups: Record<LabGroup, number> = { openai: 0, anthropic: 0, google: 0, xai: 0, china: 0, other: 0 };
for (const m of models) groups[m.labGroup]++;
console.log(`models ${models.length} ${JSON.stringify(groups)} · benchmarks ${benchmarks.length} · score records ${records.length} (${records.filter((r) => r.src === 'epoch').length} epoch / ${records.filter((r) => r.src === 'curated').length} curated) · filled cells ${cell.size}`);
console.log(`eci ${eci.length} (${eciByModel.size} matched) · metr ${metr.length} · effort pts ${effort.length} · breakthroughs ${breakthroughs.length} · capex q ${capex.quarters.length} · commitments ${commitments.length} · ai2027 ${ai2027?.milestones.length ?? 0} · proxies ${proxies.length}`);
console.log(`unmatched epoch bases ${unmatched.size} (reports/unmatched.json) · validation issues ${issues.length} (reports/validation.json)`);
for (const i of issues.slice(0, 15)) console.warn(`  ! ${i.file} ${i.where}: ${i.message}`);
if (strict && issues.length) process.exitCode = 1;
