import type { LabGroup, LabId } from '../../shared/types.ts';

export const LAB_GROUPS: LabGroup[] = ['openai', 'anthropic', 'google', 'xai', 'china'];

export const LAB_META: Record<LabGroup, { label: string; shape: 'circle' | 'diamond' | 'triangle' | 'rect' | 'pin' | 'roundRect'; glyph: string }> = {
  openai: { label: 'OpenAI', shape: 'circle', glyph: '●' },
  anthropic: { label: 'Anthropic', shape: 'diamond', glyph: '◆' },
  google: { label: 'Google', shape: 'triangle', glyph: '▲' },
  xai: { label: 'xAI', shape: 'rect', glyph: '■' },
  china: { label: 'Chinese labs', shape: 'pin', glyph: '⬟' },
  other: { label: 'Other', shape: 'roundRect', glyph: '▪' },
};

export const LAB_NAME: Record<LabId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google DeepMind',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  alibaba: 'Alibaba Qwen',
  moonshot: 'Moonshot AI',
  zhipu: 'Zhipu (Z.ai)',
};

export const labVar = (g: LabGroup) => `var(--lab-${g})`;
