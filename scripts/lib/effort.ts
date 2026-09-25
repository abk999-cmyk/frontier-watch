import type { Effort } from '../../shared/types.ts';

const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'promax', 'unknown']);

/**
 * Split an Epoch "Model version" string into its base model and effort setting.
 *   gpt-6-astra_max              → { base: 'gpt-6-astra', effort: 'max' }
 *   claude-opus-4-6_120K         → { base: 'claude-opus-4-6', budget: '120K' }
 *   gemini-3.1-pro-preview       → { base: 'gemini-3.1-pro-preview' }
 */
export function splitEpochVersion(version: string): { base: string; effort?: Effort; budget?: string } {
  const v = version.trim();
  const m = v.match(/^(.*)_([a-z]+)$/i);
  if (m && EFFORTS.has(m[2].toLowerCase())) return { base: m[1], effort: m[2].toLowerCase() as Effort };
  if (m && m[2].toLowerCase() === 'c') return { base: m[1], effort: 'unknown' };
  // Pro mode (parallel test-time compute) with an effort: _promax, _proxhigh, _prounknown → 'promax'.
  if (m && /^pro(none|minimal|low|medium|high|xhigh|max|unknown)?$/i.test(m[2])) return { base: m[1], effort: 'promax' };
  const k = v.match(/^(.*)_(\d+[kK])$/);
  if (k) return { base: k[1], budget: k[2].toUpperCase() };
  return { base: v };
}

/** Normalise free-text effort labels ("Max", "XHigh", "thinking", "enabled") to the Effort vocabulary. */
export function normEffort(raw: string | undefined | null): Effort | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!s) return undefined;
  if (EFFORTS.has(s)) return s as Effort;
  if (s === 'extrahigh' || s === 'veryhigh') return 'xhigh';
  if (s === 'med') return 'medium';
  if (s === 'off' || s === 'disabled' || s === 'nothinking') return 'none';
  return 'unknown';
}

/** Canonical key for loose model-name matching: lowercase, separators unified, dates dropped. */
export function looseKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/-(\d{4}-\d{2}-\d{2}|\d{8}|\d{4})$/, '')
    .replace(/[._\s]+/g, '-')
    .replace(/-preview$/, '')
    .replace(/-+/g, '-');
}
