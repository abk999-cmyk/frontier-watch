import { useSyncExternalStore } from 'react';

/** Tiny global store for cross-tab UI state (e.g. "open this model's detail drawer"). */
function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => {
      value = v;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
  };
}

const selectedModel = createStore<string | null>(null);
export const openModel = (id: string | null) => selectedModel.set(id);
export const useSelectedModel = () => useSyncExternalStore(selectedModel.subscribe, selectedModel.get, selectedModel.get);

export type TabId = 'alan' | 'benchmarks' | 'charts' | 'timelines' | 'references';
export const TABS: { id: TabId; label: string; sub: string; key: string }[] = [
  { id: 'alan', label: 'Countdown', sub: 'AGI · ASI', key: '1' },
  { id: 'benchmarks', label: 'Benchmarks', sub: 'GPT-4 → now', key: '2' },
  { id: 'charts', label: 'Charts Lab', sub: 'trends · projections', key: '3' },
  { id: 'timelines', label: 'Timelines', sub: 'AI 2027 · 2040', key: '4' },
];

const readHash = (): TabId => {
  const h = (typeof location !== 'undefined' ? location.hash.replace('#', '').split('?')[0] : '') as TabId;
  return TABS.some((t) => t.id === h) || h === 'references' ? h : 'alan';
};
const tab = createStore<TabId>(readHash());
if (typeof window !== 'undefined') window.addEventListener('hashchange', () => tab.set(readHash()));
export const setTab = (id: TabId) => {
  if (location.hash !== `#${id}`) history.pushState(null, '', `#${id}`);
  tab.set(id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
export const useTab = () => useSyncExternalStore(tab.subscribe, tab.get, tab.get);
