import { useSyncExternalStore } from 'react';
import type { LabGroup } from '../../shared/types.ts';

export type Theme = 'dark' | 'light';
const KEY = 'fw-theme';
const listeners = new Set<() => void>();

function readStored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* storage unavailable */
  }
  return 'dark';
}

let current: Theme = typeof document !== 'undefined' ? readStored() : 'dark';
if (typeof document !== 'undefined') document.documentElement.dataset.theme = current;

export function setTheme(t: Theme) {
  current = t;
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => current,
    () => 'dark',
  );
}

export interface Tokens {
  theme: Theme;
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  line: string;
  line2: string;
  text: string;
  text2: string;
  text3: string;
  accent: string;
  glowA: string;
  glowB: string;
  grid: string;
  axis: string;
  good: string;
  warn: string;
  serious: string;
  critical: string;
  lab: Record<LabGroup, string>;
  font: string;
  mono: string;
}

/** Resolve CSS custom properties into concrete colours for canvas/WebGL renderers. */
export function readTokens(theme: Theme): Tokens {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    theme,
    bg: v('--bg'),
    surface: v('--surface'),
    surface2: v('--surface-2'),
    surface3: v('--surface-3'),
    line: v('--line'),
    line2: v('--line-2'),
    text: v('--text'),
    text2: v('--text-2'),
    text3: v('--text-3'),
    accent: v('--accent'),
    glowA: v('--glow-a'),
    glowB: v('--glow-b'),
    grid: v('--grid'),
    axis: v('--axis'),
    good: v('--good'),
    warn: v('--warn'),
    serious: v('--serious'),
    critical: v('--critical'),
    lab: {
      openai: v('--lab-openai'),
      anthropic: v('--lab-anthropic'),
      google: v('--lab-google'),
      xai: v('--lab-xai'),
      china: v('--lab-china'),
      other: v('--lab-other'),
    },
    font: "'Geist Variable', system-ui, sans-serif",
    mono: "'Geist Mono Variable', ui-monospace, monospace",
  };
}

const tokenCache = new Map<Theme, Tokens>();

/** Stable per theme, so chart effects only re-run when the theme actually flips. */
export function useTokens(): Tokens {
  const theme = useTheme();
  let t = tokenCache.get(theme);
  if (!t) tokenCache.set(theme, (t = readTokens(theme)));
  return t;
}
