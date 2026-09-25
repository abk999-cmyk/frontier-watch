import { use } from 'react';
import type { AlanData, CoreData, ScoresData, TrendsData } from '../../shared/types.ts';

const cache = new Map<string, Promise<unknown>>();

/** Load a bundle from public/data once; components read it with React's `use()` inside <Suspense>. */
export function load<T>(name: string): Promise<T> {
  let p = cache.get(name);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/${name}.json`, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${name}.json (HTTP ${r.status}). Run \`npm run refresh\`.`);
      return r.json();
    });
    cache.set(name, p);
  }
  return p as Promise<T>;
}

export const useCore = () => use(load<CoreData>('core'));
export const useScores = () => use(load<ScoresData>('scores'));
export const useTrends = () => use(load<TrendsData>('trends'));
export const useAlan = () => use(load<AlanData>('alan'));
export const useCharts = () => use(load<any>('charts'));
export const useTimelines = () => use(load<any>('timelines'));
