# Frontier Watch

A personal AI-progress observatory with four tabs:

| Tab | What's in it |
|---|---|
| **Countdown** | Dr Alan D. Thompson's AGI countdown (3D gauge + full history) and his 50-item ASI checklist (3D orbit, with a replay of how it lit up over time) |
| **Benchmarks** | Every frontier model from GPT-4 to today × HLE / SWE / agentic / science / math / bio benchmarks. Independent and lab-reported results are marked apart. Also: new-pre-train ◆ and scaling-vector ⚡ markers, and a 3D skyline view |
| **Charts Lab** | Capability over time (ECI, METR horizons, any benchmark), a 3D capability space, cost-to-capability, effort vs tokens, a projection workbench, AI capex and compute commitments, longevity escape velocity, AI math/science breakthroughs |
| **Timelines** | AI 2027 vs reality (lag meter, milestone track, forecast drift) and AI 2040: Plan A as a policy path |

## Run it

```bash
npm install
npm run refresh   # fetch live sources + rebuild public/data/*.json
npm run dev       # http://localhost:5178
```

## Update the data

- `npm run fetch` downloads the live sources into `data/raw/`: the Epoch AI benchmark zip, and Alan's AGI page, ASI sheet and animation log. Each fetcher checks what it got and keeps the last good copy if a site changes its markup. It also writes a dated snapshot to `data/snapshots/`, so history builds up over time.
- `npm run build:data` merges the fetched data with the hand-curated YAML in `data/curated/` and writes `public/data/*.json`. Add `-- --strict` to fail on any validation issue.
  - `reports/validation.json` lists any curated rows that failed their schema.
  - `reports/coverage.json` counts filled cells per model and per benchmark.
  - `reports/unmatched.json` lists Epoch model names not mapped to the registry.
- `npm test` runs the unit tests (projection math, ASI replay, lag computation).
- Curated formats are documented in [`data/curated/README.md`](data/curated/README.md). Every fact carries a source URL.
- UI conventions live in [`docs/DESIGN.md`](docs/DESIGN.md).

## Sources & attribution

- **Epoch AI**: Benchmarking Hub, Epoch Capabilities Index and AI-model data. CC-BY 4.0 · https://epoch.ai/benchmarks
- **Dr Alan D. Thompson, LifeArchitect.ai**: AGI countdown and ASI checklist. Used with citation, as his pages request · https://lifearchitect.ai/agi/ · https://lifearchitect.ai/asi/
- **AI Futures Project**: AI 2027 (https://ai-2027.com) and AI 2040: Plan A (https://ai-2040.com)
- **METR** time horizons (via Epoch), and the lab model and system cards, leaderboards (tbench.ai, Scale, ARC Prize…) and company filings linked per data point.

Things only Abhinav can provide (API keys, deploy decisions) are tracked in [`ASKS.md`](ASKS.md).
