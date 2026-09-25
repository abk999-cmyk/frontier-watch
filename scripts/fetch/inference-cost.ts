import path from 'node:path';
import Papa from 'papaparse';
import { RAW, SNAPSHOTS, UA } from '../lib/paths.ts';
import { fetchWithRetry, today, writeJson } from '../lib/io.ts';

const BASE = 'https://raw.githubusercontent.com/droodman/inference-cost/main';
const RECORDS_URL = `${BASE}/output/slides/Figure%202.csv`;
const DECLINES_URL = `${BASE}/output/tables/staircase_check.csv`;

async function csv(url: string) {
  const res = await fetchWithRetry(url, { headers: { 'User-Agent': UA } });
  return Papa.parse<Record<string, string>>((await res.text()).replace(/^﻿/, ''), { header: true, skipEmptyLines: true }).data;
}

/**
 * Epoch "The Plunging Price of Thought" (Sep 2026): cost-per-task record holders at 25% / 75%
 * accuracy per benchmark, plus the model-free quarterly decline rate per benchmark.
 */
export async function fetchInferenceCost() {
  const [recRows, decRows] = await Promise.all([csv(RECORDS_URL), csv(DECLINES_URL)]);
  const records = recRows
    .map((r) => ({ bench: r.bench, benchmark: r.benchmark, level: Number(r.level), model: r.model_label, acc: Number(r.acc), date: r.date, cost: Number(r.cost) }))
    .filter((r) => r.date && Number.isFinite(r.cost) && r.cost > 0);
  const declines = decRows.map((r) => ({ benchmark: r.benchmark, declinePctPerQuarter: Number(r.decline_pct_qtr), nodes: Number(r.n_nodes) })).filter((d) => Number.isFinite(d.declinePctPerQuarter));
  if (records.length < 20) throw new Error(`inference-cost records too few (${records.length})`);
  const data = { fetchedAt: new Date().toISOString(), source: 'https://epoch.ai/publications/the-plunging-price-of-thought', repo: 'https://github.com/droodman/inference-cost', records, declines };
  writeJson(path.join(RAW, 'inference-cost.json'), data);
  writeJson(path.join(SNAPSHOTS, 'inference-cost', `${today()}.json`), { fetchedAt: data.fetchedAt, records: records.length, declines: declines.length }, true);
  return `${records.length} cost-record points across ${new Set(records.map((r) => r.bench)).size} benchmarks · ${declines.length} decline rates`;
}
