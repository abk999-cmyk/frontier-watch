import path from 'node:path';
import Papa from 'papaparse';
import { RAW, SNAPSHOTS, UA } from '../lib/paths.ts';
import { fetchWithRetry, today, writeJson } from '../lib/io.ts';

const RECORD_URL = 'https://ourworldindata.org/grapher/maximum-life-expectancy-sex-female.csv';
const REMAINING_URL = 'https://ourworldindata.org/grapher/remaining-life-expectancy-at-different-ages.csv?v=1&csvType=full&useColumnShortNames=true';
const ENTITIES = ['Japan', 'United States', 'United Kingdom', 'South Korea', 'France', 'World'];

async function csv(url: string) {
  const res = await fetchWithRetry(url, { headers: { 'User-Agent': UA } });
  return Papa.parse<Record<string, string>>(await res.text(), { header: true, skipEmptyLines: true }).data;
}

/** Our World in Data: record (best-country) female life expectancy + remaining life expectancy at 0/65/80 for a few countries. */
export async function fetchOwid() {
  const [recordRows, remRows] = await Promise.all([csv(RECORD_URL), csv(REMAINING_URL)]);
  const record = recordRows
    .map((r) => ({ year: Number(r['Year']), value: Number(r['Life expectancy']), country: r['Country with yearly maximum life expectancy - Sex: female'] }))
    .filter((r) => Number.isFinite(r.year) && Number.isFinite(r.value))
    .sort((a, b) => a.year - b.year);
  const num = (s: string | undefined) => (s === undefined || s === '' ? null : Number(s));
  const remaining: Record<string, { year: number; e0: number | null; e65: number | null; e80: number | null }[]> = {};
  for (const r of remRows) {
    if (!ENTITIES.includes(r.entity)) continue;
    (remaining[r.entity] ??= []).push({
      year: Number(r.year),
      e0: num(r.life_expectancy__sex_total__age_0__type_period),
      e65: num(r.life_expectancy__sex_total__age_65__type_period),
      e80: num(r.life_expectancy__sex_total__age_80__type_period),
    });
  }
  for (const k of Object.keys(remaining)) remaining[k].sort((a, b) => a.year - b.year);
  if (record.length < 100) throw new Error(`OWID record series too short (${record.length})`);
  if (!remaining.Japan?.length) throw new Error('OWID remaining-life-expectancy: Japan missing (columns renamed?)');
  const data = { fetchedAt: new Date().toISOString(), sources: { record: RECORD_URL, remaining: REMAINING_URL }, record, remaining };
  writeJson(path.join(RAW, 'owid-life-expectancy.json'), data);
  writeJson(path.join(SNAPSHOTS, 'owid', `${today()}.json`), { fetchedAt: data.fetchedAt, recordLatest: record.at(-1), entities: Object.keys(remaining) }, true);
  return `record ${record[0].year}–${record.at(-1)!.year} · remaining LE for ${Object.keys(remaining).length} entities`;
}
