import type { ForecastUpdate } from './types.ts';

// Canonical milestone keys for the authors' forecast updates. Colour follows the milestone
// (categorical slots 1–4, fixed order); line style follows the forecaster.
export type MilestoneKey = 'ac' | 'sar' | 'asi' | 'tedai';
export const MILESTONE_KEYS: MilestoneKey[] = ['ac', 'sar', 'asi', 'tedai'];
export const MILESTONE_META: Record<MilestoneKey, { label: string; short: string; slot: 'blue' | 'orange' | 'aqua' | 'yellow' }> = {
  ac: { label: 'Automated coder', short: 'AC', slot: 'blue' },
  sar: { label: 'Superhuman AI researcher', short: 'SAR', slot: 'orange' },
  asi: { label: 'Superintelligence (ASI)', short: 'ASI', slot: 'aqua' },
  tedai: { label: 'Top-expert-dominating AI', short: 'TED-AI', slot: 'yellow' },
};

/** Map a free-text milestone id/name onto a canonical key, or null for anything else. */
export function milestoneKey(raw: string): MilestoneKey | null {
  const s = raw.toLowerCase().replace(/[_\s]+/g, '-');
  if (/ted-?ai|top-?expert/.test(s)) return 'tedai';
  if (/siar|superintelligent-ai-researcher/.test(s)) return null; // distinct from ASI
  if (/^sar$|superhuman-ai-researcher|superhuman-researcher/.test(s)) return 'sar';
  if (/^asi$|artificial-superintelligence|^superintelligence$|broad-superintelligence/.test(s)) return 'asi';
  if (/^ac$|^sc$|automated-coder|superhuman-coder/.test(s)) return 'ac';
  return null;
}

export type ForecasterStyle = 'solid' | 'dashed' | 'dotted';
export function forecasterStyle(name: string): ForecasterStyle {
  const s = name.toLowerCase();
  if (/daniel|kokotajlo/.test(s)) return 'solid';
  if (/\beli\b|lifland/.test(s)) return 'dashed';
  return 'dotted';
}
const RANK: Record<ForecasterStyle, number> = { solid: 0, dashed: 1, dotted: 2 };
export interface ForecasterMark {
  line: ForecasterStyle;
  symbol: string; // ECharts symbol
  glyph: string; // same shape as a text glyph, for legends
}
const OTHER_MARKS: [string, string][] = [
  ['triangle', '▲'],
  ['rect', '■'],
  ['pin', '⬟'],
  ['roundRect', '▪'],
];
/** Daniel = solid ●, Eli = dashed ◆, everyone else dotted with their own marker shape. */
export function forecasterMarks(names: string[]): Map<string, ForecasterMark> {
  const out = new Map<string, ForecasterMark>();
  let k = 0;
  for (const n of [...new Set(names)].sort((a, b) => RANK[forecasterStyle(a)] - RANK[forecasterStyle(b)] || a.localeCompare(b))) {
    const line = forecasterStyle(n);
    if (line === 'solid') out.set(n, { line, symbol: 'circle', glyph: '●' });
    else if (line === 'dashed') out.set(n, { line, symbol: 'diamond', glyph: '◆' });
    else {
      const [symbol, glyph] = OTHER_MARKS[Math.min(k++, OTHER_MARKS.length - 1)];
      out.set(n, { line, symbol, glyph });
    }
  }
  return out;
}
/** The two authors who publish running medians (Daniel Kokotajlo, Eli Lifland). */
export const isPrincipal = (name: string) => forecasterStyle(name) !== 'dotted';

/** Latest published median per forecaster for one milestone key. */
export function latestMedians(updates: ForecastUpdate[], key: MilestoneKey): ForecastUpdate[] {
  const best = new Map<string, ForecastUpdate>();
  for (const u of updates) {
    if (milestoneKey(u.milestone) !== key) continue;
    const prev = best.get(u.forecaster);
    if (!prev || u.published > prev.published) best.set(u.forecaster, u);
  }
  return [...best.values()].sort((a, b) => RANK[forecasterStyle(a.forecaster)] - RANK[forecasterStyle(b.forecaster)] || a.forecaster.localeCompare(b.forecaster));
}
