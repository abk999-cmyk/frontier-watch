import type { LabGroup, LabId } from '../../shared/types.ts';

export const LAB_GROUP: Record<LabId, LabGroup> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  xai: 'xai',
  deepseek: 'china',
  alibaba: 'china',
  moonshot: 'china',
  zhipu: 'china',
};

/** Map an Epoch "Organization"/"Country" pair to one of our five colour groups. */
export function orgToGroup(org: string | undefined, country?: string): LabGroup {
  const o = (org ?? '').toLowerCase();
  if (o.includes('openai')) return 'openai';
  if (o.includes('anthropic')) return 'anthropic';
  if (o.includes('google') || o.includes('deepmind')) return 'google';
  if (o.includes('xai') || o === 'x.ai' || o.includes('spacexai')) return 'xai';
  if ((country ?? '').toLowerCase().includes('china')) return 'china';
  if (/(deepseek|alibaba|qwen|moonshot|zhipu|z\.ai|minimax|baidu|tencent|bytedance|stepfun|01\.ai)/.test(o)) return 'china';
  return 'other';
}
