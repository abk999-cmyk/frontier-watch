# Curated data: format spec

These are hand-maintained YAML files. The build script (`scripts/build-data.ts`) checks each one against a zod schema in `scripts/lib/schemas.ts`, so the formats below are binding.

**Rules for every file**
- Every fact carries a `url` (or `sources: [url…]`) pointing to where it came from. Primary sources win: lab posts, model/system cards, papers, official leaderboards.
- Use ISO dates, `YYYY-MM-DD`. If only the month is known, use the 1st and set `datePrecision: month`.
- Never invent a number. If you can't find it, leave it out; blank cells are fine.
- Percentages are written 0–100, not 0–1.
- IDs are kebab-case and must exist in `models.yaml` / `benchmarks.yaml`. The one exception is `newBenchmarks` inside a scores file, which declares new ones.

## models.yaml
```yaml
- id: gpt-6-astra            # stable id, never rename
  name: GPT-6 Astra
  lab: openai                # openai | anthropic | google | xai | deepseek | alibaba | moonshot | zhipu
  released: 2026-09-03
  tier: flagship             # flagship | variant (variants collapse under variantOf)
  variantOf: null            # parent id for Pro/Heavy/sibling variants
  status: released           # released | announced | restricted
  pretrain: true             # true = new base model (new pre-train); false = post-train of an existing base; null = unknown
  pretrainNote: "~1e27 FLOP new base on Stargate Abilene"   # optional, short
  scalingVector: recurrent-depth   # optional id from scaling-vectors.yaml (this model INTRODUCED it)
  trainingFlop: 1.0e27       # optional (Epoch estimate)
  params: "~8T (reported)"   # optional free text
  openWeights: false
  epochIds: [gpt-6-astra]    # every base "Model version" string used in Epoch CSVs, with the effort suffix (_high, _max…) stripped
  sources: [https://…]
```

## scaling-vectors.yaml
```yaml
- id: test-time-reasoning
  name: RL-trained test-time reasoning
  introducedBy: o1-preview
  date: 2024-09-12
  summary: One or two sentences.
  url: https://…
```

## benchmarks.yaml
See the file itself. The fields are: `id, name, short, group, version, unit, higherIsBetter, ceiling, saturatedOn, released, url, description, epoch` (how it is fetched from Epoch; optional).

## scores/<lab>.yaml: lab-reported and leaderboard scores
```yaml
newBenchmarks: []            # optional; same shape as a benchmarks.yaml entry, for benchmarks not already listed
scores:
  - model: claude-opus-4.5
    benchmark: swe-bench-verified
    value: 80.9              # pct 0–100 | minutes | usd | points, per the benchmark's unit
    provenance: lab          # lab = the model's own lab reported it; independent = a third-party leaderboard or eval org
    tools: false             # true if optional tools (search / code execution) were used. Only meaningful for HLE, science,
                             # math and bio; ignored for swe/agentic benchmarks, which always run in a tool harness
    effort: high             # optional: none | minimal | low | medium | high | xhigh | max | unknown
    setting: "64K thinking budget; bash+edit tools"   # optional free text on conditions
    date: 2025-11-24         # when the number was published
    source: "Introducing Claude Opus 4.5"
    url: https://…
```

## ai2027.yaml, ai2027-updates.yaml, ai2027-proxies.yaml, ai2040.yaml
The formats are documented at the top of each file.

## breakthroughs.yaml
```yaml
- id: alphafold2-casp14
  date: 2020-11-30
  title: AlphaFold 2 solves protein structure prediction at CASP14
  domain: science            # math | science
  field: structural biology
  system: AlphaFold 2
  org: Google DeepMind
  significance: 5            # 0 rediscovery · 1 moderately interesting · 2 solid result · 3 major advance · 4 breakthrough · 5 Millennium/Nobel-level
  verification: peer-reviewed   # formal-proof | peer-reviewed | expert-endorsed | claimed | disputed
  autonomy: tool             # tool (AI as instrument) | collaborative (human+AI) | autonomous (AI did it end-to-end)
  summary: One or two sentences.
  url: https://…
```

## spending-commitments.yaml, lev.yaml
The formats are documented at the top of each file.
