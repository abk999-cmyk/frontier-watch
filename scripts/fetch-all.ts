import { fetchEpoch } from './fetch/epoch.ts';
import { fetchAlan } from './fetch/alan.ts';
import { fetchOwid } from './fetch/owid.ts';
import { fetchInferenceCost } from './fetch/inference-cost.ts';

const jobs: [string, () => Promise<string>][] = [
  ['epoch', fetchEpoch],
  ['alan', fetchAlan],
  ['owid', fetchOwid],
  ['cost', fetchInferenceCost],
];

const only = process.argv.slice(2);
let failed = 0;
for (const [name, job] of jobs) {
  if (only.length && !only.includes(name)) continue;
  const t0 = Date.now();
  try {
    const msg = await job();
    console.log(`✓ ${name.padEnd(10)} ${msg}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name.padEnd(10)} ${(e as Error).message}  — keeping last good raw data`);
  }
}
if (failed) process.exitCode = 1;
