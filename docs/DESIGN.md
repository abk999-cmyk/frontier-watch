# Frontier Watch: design & code conventions

The dashboard is a dark "observatory": glass panels floating over a live 3D starfield, lime signal accents, and data that is precise and legible. It should feel cool as hell, but the data stays honest. Every agent building UI in this repo follows this file.

## Stack
- React 19 + TypeScript (strict), Vite, Tailwind v4 (tokens in `src/styles/theme.css`).
- Charts: **ECharts 6** through `src/charts/EChart.tsx`. Pass `option={(t) => ({...})}`, where `t` holds resolved theme tokens. The wrapper adds the hairline axes, grid, tooltip styling and fonts, so don't restyle axes unless you need to. Memoise the option builder with `useCallback`.
- 3D: `@react-three/fiber` + `@react-three/drei` + `@react-three/postprocessing` (Bloom). Put each 3D scene in its own `<Canvas>`, lazy-loaded where possible. Use `dpr={[1, 2]}` and `frameloop="demand"` unless the scene is animating.
- Motion: `motion/react` (`motion.div`, `AnimatePresence`, `layoutId`).
- Data: `src/lib/data.ts` hooks (`useCore`, `useScores`, `useTrends`, `useAlan`, `useCharts`, `useTimelines`) use React `use()`. Always call them under `<Suspense>`; tabs are already wrapped. The types are in `shared/types.ts`. The `charts.json` / `timelines.json` shapes follow the YAML formats in `data/curated/README.md` and `scripts/build-data.ts`.

## Primitives: reuse, don't reinvent
- `Panel` (`src/components/ui/Panel.tsx`): glass card with spotlight hover. Props: `kicker`, `title`, `actions`, `footer`. Use it for compact modules such as charts and stat groups. Big reading surfaces (the evidence feed, discoveries, the benchmark matrix, references) are unboxed page sections instead, per Abhinav's feedback: a kicker + h2 + lede on the page background, with full-width content.
- `Segmented`, `Chip` (with lab colour glyph); `Stat`, `Drawer`, `InfoTip`, `Legend`, `Skeleton`, `ErrorBoundary` (in `src/components/ui/misc.tsx`).
- `src/lib/format.ts`: date/number formatting (`fmtMinutes`, `fmtUsd`, `fmtValue`, `monthYear`, `yearFrac`, `fromYearFrac`…).
- `src/lib/labs.ts`: `LAB_GROUPS`, `LAB_META[group].label/shape/glyph`, `labVar(group)`.
- `src/lib/tokens.ts`: `useTokens()` → `t.lab[group]`, `t.text`, `t.accent`, etc.
- `src/lib/scores.ts`: `indexScores`, `bestRecord`.
- `src/lib/ui-state.ts`: `openModel(id)` opens the model detail drawer from anywhere.

## Visual rules
- Layout: 12-column feel using CSS grid (`grid gap-5 lg:grid-cols-12`); modules span 4/6/8/12. Tab header: a big title (text-[28px]–[40px], font-semibold, tracking-tight) with a one-line lede in `text-ink-2`, a `kicker` above it, and hero stats in a row.
- Type: Geist for UI, Geist Mono for kickers/labels/axis ticks. Hero numbers use proportional figures; `tnum` only in tables and aligned columns.
- Colour tokens (Tailwind classes): `bg-surface`, `bg-surface-2`, `border-line`, `border-line-2`, `text-ink`, `text-ink-2`, `text-ink-3`, `bg-accent`, `text-accent-ink`. CSS vars: `--lab-openai|anthropic|google|xai|china|other`, `--good --warn --serious --critical`, `--glow-a --glow-b` (decorative only).
- **Lab identity** always uses the lab colour AND a second cue. In scatter plots that's the marker shape from `LAB_META[g].shape` (ECharts `symbol`); in legends, glyph plus label. With more than 3 series in a scatter, colour alone is never enough.
- **Text never wears a series colour.** Labels and values use ink tokens; a coloured glyph or mark next to them carries identity.
- Marks: 2px lines, markers ≥ 8px, thin bars with 4px rounded data-ends, 2px gaps between stacked segments (`itemStyle.borderColor = t.surface`, `borderWidth: 2`). Direct-label selectively (endpoints, extremes), never every point.
- **One y-axis per chart.** No dual axes: use two charts, or index to a common base.
- Status colours (good/warn/serious/critical) are only for state (achieved, partial, off-track…), never for series, and always with an icon or label.
- Projections and forecasts are dashed lines and translucent bands (`areaStyle` with low opacity), clearly labelled "projection".
- Every chart has hover tooltips and a legend for ≥2 series. Every numeric chart also has a "Table" toggle (a Segmented `Chart | Table`) showing the same data as a plain table. That's our accessibility twin.
- Filters sit in one row at the top of the module (in `Panel` `actions`), never inside the plot.
- Empty or partial data: render an honest empty state ("No data yet: run `npm run refresh`" or "Curated file missing: data/curated/x.yaml"), never crash. Guard every optional field.
- Motion: subtle. Entrance fades/slides of ≤300ms, springy toggles. Respect `prefers-reduced-motion` (the CSS already neutralises animations; for r3f, stop auto-rotation when reduced).
- Responsive: must work at 375px wide. Stack columns, and make wide tables scroll inside their panel (never the page).

## Files & ownership
- Tab entry: `src/tabs/<Name>Tab.tsx` (default export).
- Tab-specific pieces live in `src/tabs/<name>/…` (e.g. `src/tabs/charts/CapabilityChart.tsx`), 3D scenes in `src/components/three/`.
- Pure math in `src/lib/` with vitest tests next to it (`*.test.ts`).
- Don't edit shared primitives, `App.tsx`, `Header.tsx`, `theme.css`, `shared/types.ts` or the data pipeline without coordinating. If you need something, add it in your own folder, or note it in your final report.

## Filters (iteration 2): use the kit, don't hand-roll
Abhinav wants comprehensive filters wherever there's a list, table or feed.

Components are in `src/components/filters/Filters.tsx`:
- `MultiSelect`: searchable checkbox list. Takes `options: {value,label,count?,color?,glyph?,group?,hint?}[]`; an empty selection means "any".
- `SingleSelect`, for sort and view options.
- `DateFilter`: calendar popover with Any / Before / After / Between modes, presets, and manual date inputs. Pass `marks` (a Set of ISO dates that have data) so the calendar shows dots on days with entries.
- `RangeFilter`: dual-thumb numeric range.
- `ToggleFilter`: a boolean switch pill.
- `SearchInput`.
- `ActiveFilters`: removable pills plus "Clear all" and the "N / total results" count.
- `FilterButton` (generic popover trigger) and `Popover` (portalled; escapes overflow containers).

Pure predicates and helpers are in `src/lib/filters.ts`:
- `matchDate`, `inRange`, `matchAny`, `textMatch`
- `highlightParts`, for highlighting search hits in results
- `countBy`, for facet counts shown as option badges
- `hostOf`, `summarizeDate`, `isDateActive`, `isRangeActive`

Pattern:
1. Keep one state object per view: `{ q, date, labs: [], … }`.
2. Filter in a `useMemo`.
3. Compute facet counts from the unfiltered (or other-filter-applied) items.
4. Render a filter row (wrapping flex, `gap-2`) with `ActiveFilters` under it, showing the result count.
5. Every filter must be clearable from its pill.
6. Empty result → an honest empty state with a "Clear filters" button.
