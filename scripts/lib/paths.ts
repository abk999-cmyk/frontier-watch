import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CURATED = path.join(ROOT, 'data/curated');
export const RAW = path.join(ROOT, 'data/raw');
export const SNAPSHOTS = path.join(ROOT, 'data/snapshots');
export const OUT = path.join(ROOT, 'public/data');
export const REPORTS = path.join(ROOT, 'reports');
export const UA = 'Mozilla/5.0 (FrontierWatch personal AI-progress dashboard; contact: local)';
