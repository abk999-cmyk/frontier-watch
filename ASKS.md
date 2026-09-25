# Things to ask Abhinav

Things that need Abhinav's input or his own hands. Go through this list before any commit or push.

## Open
- [ ] **Artificial Analysis API key.** It's free, but Abhinav has to register at artificialanalysis.ai. It would unlock:
  - daily AA Intelligence Index snapshots, so history builds up
  - tokens used to run the index, for the effort-vs-tokens charts
  - price columns

  Until then, Epoch's Capabilities Index (ECI) is used.
- [ ] **Vercel deploy** once the dashboard is fully ready: which team, project name, domain?
- [ ] **Auto-refresh:** a local nightly job (launchd) running `npm run refresh` now, or a GitHub Action after the move to Vercel?
- [ ] **Optional: Metaculus API token.** The LEV forecast (median May 2053) is currently hand-copied into `data/curated/lev.yaml`, because the Metaculus API needs an account token. A token would let it refresh automatically.
- [ ] **Optional: Human Mortality Database account** (free, needs your registration), for finer LEV data. The Our World in Data mirror of HMD covers the current charts.
- [ ] **Data policy: checkpoint releases.** Later checkpoints (DeepSeek R1-0528, V3-0324, Qwen3-2507, Kimi K2-0905, V4-Pro GA) are folded into their parent model's row and tagged `checkpoint: …` in the source setting. Keep them folded, or give each its own row?
- [ ] **Data policy: models not yet tracked.** Kimi K2 Thinking, DeepSeek V3.1/V3.2 and GLM-5.1/5.2 have scores available but no row. Add them?

## Resolved
- Git: private repo `abk999-cmyk/frontier-watch` created and pushed (2026-09-25). To make it public: `gh repo edit abk999-cmyk/frontier-watch --visibility public --accept-visibility-change-consequences`.
- AI 2040 = AI Futures Project's "Plan A", shown as a policy path (2026-09-24).
- MiniMax and Meta Muse Spark excluded; Mythos included (2026-09-24).
- The benchmark table shows the highest score across effort levels by default (2026-09-24).
