import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { RAW, SNAPSHOTS, UA } from '../lib/paths.ts';
import { ensureDir, fetchWithRetry, today, writeJson } from '../lib/io.ts';

const ZIP_URL = 'https://epoch.ai/data/benchmark_data.zip';

/** Download Epoch's benchmark hub zip (CC-BY) and unpack every CSV into data/raw/epoch/. */
export async function fetchEpoch() {
  const res = await fetchWithRetry(ZIP_URL, { headers: { 'User-Agent': UA } });
  const buf = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(buf);
  const dir = path.join(RAW, 'epoch');
  rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
  let n = 0;
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    const out = path.join(dir, name.replace(/^benchmark_data\//, ''));
    ensureDir(path.dirname(out));
    writeFileSync(out, data);
    n++;
  }
  if (n < 20) throw new Error(`Epoch zip looks wrong: only ${n} files`);
  writeJson(path.join(SNAPSHOTS, 'epoch', `${today()}.json`), { fetchedAt: new Date().toISOString(), files: n, bytes: buf.length }, true);
  return `${n} files, ${(buf.length / 1e6).toFixed(1)} MB`;
}
