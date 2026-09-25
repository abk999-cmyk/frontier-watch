import path from 'node:path';
import * as cheerio from 'cheerio';
import Papa from 'papaparse';
import { RAW, SNAPSHOTS, UA } from '../lib/paths.ts';
import { fetchWithRetry, today, writeJson } from '../lib/io.ts';
import type { AgiData, AsiData, AsiItem, AsiStatus } from '../../shared/types.ts';

const AGI_URL = 'https://lifearchitect.ai/agi/';
const ASI_URL = 'https://lifearchitect.ai/asi/';
const ASI_ANIM_URL = 'https://lifearchitect.ai/asi-animation.html';
const ASI_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRXekMEE3KEmD0ADHCGVBW1Ki0vFaectMyFgz0I1vu9qc1zfIjzLxih5xxeoKrSXCdq4chM-W-eTMDp/pub?output=csv';

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** "Sep/2026" → "2026-09-01"; "2026" → "2026-01-01"; unparseable → null. */
export function parseAlanDate(s: string): string | null {
  const t = s.trim();
  const m = t.match(/([A-Za-z]{3})[a-z]*\s*\/\s*(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[2]}-${MONTHS[m[1].toLowerCase()]}-01`;
  const y = t.match(/^(\d{4})$/);
  if (y) return `${y[1]}-01-01`;
  return null;
}

async function get(url: string) {
  const res = await fetchWithRetry(url, { headers: { 'User-Agent': UA } });
  return res.text();
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function links($: cheerio.CheerioAPI, el: cheerio.Cheerio<any>) {
  return el
    .find('a')
    .toArray()
    .map((a) => ({ label: clean($(a).text()) || 'link', url: $(a).attr('href') ?? '' }))
    .filter((l) => l.url.startsWith('http'));
}

export function parseAgi(html: string): Omit<AgiData, 'fetchedAt'> {
  const gauge = html.match(/gauge\.set\((\d+(?:\.\d+)?)\)/);
  if (!gauge) throw new Error('AGI gauge value not found (page markup changed?)');
  const value = Number(gauge[1]);
  if (!(value >= 0 && value <= 100)) throw new Error(`AGI gauge out of range: ${value}`);
  const $ = cheerio.load(html);
  const lastRaw = clean($('#last-update').text()).replace(/^Last update:\s*/i, '');
  const lastUpdate = parseAlanDate(lastRaw) ?? lastRaw;

  // The countdown log is the striped table whose header is Date | Summary | Links.
  const table = $('table.table-striped')
    .toArray()
    .find((t) => clean($(t).find('thead').text()).startsWith('Date Summary'));
  if (!table) throw new Error('AGI log table not found');
  const log: AgiData['log'] = [];
  $(table)
    .find('tbody > tr')
    .each((_, tr) => {
      const tds = $(tr).children('td');
      if (tds.length < 2) return;
      const date = parseAlanDate(clean($(tds[0]).text()));
      if (!date) return;
      const cell = $(tds[1]);
      const title = clean(cell.find('strong').first().text());
      const full = clean(cell.text());
      const pct = title.match(/^(\d{1,3})%\s*:/) ?? full.match(/^(\d{1,3})%\s*:/);
      log.push({
        date,
        kind: pct ? 'pct' : 'info',
        value: pct ? Number(pct[1]) : undefined,
        title: title.replace(/^(\d{1,3}%|INFO)\s*:\s*/i, ''),
        summary: full.slice(title.length).trim().slice(0, 900),
        links: tds.length > 2 ? links($, $(tds[2])) : [],
      });
    });
  if (log.length < 20) throw new Error(`AGI log suspiciously short (${log.length} rows)`);

  const history = log
    .filter((l) => l.kind === 'pct' && l.value !== undefined)
    .map((l) => ({ date: l.date, value: l.value!, summary: l.title }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.value - b.value);
  return { value, lastUpdate, history, log };
}

const STATUS_BY_EMOJI: Record<string, AsiStatus> = { '🟢': 'achieved', '🟠': 'partial' };
const emojiStatus = (s: string): AsiStatus => {
  for (const [e, st] of Object.entries(STATUS_BY_EMOJI)) if (s.includes(e)) return st;
  return 'none';
};

export function parseAsiSheet(csv: string, keywords: Map<number, string>): AsiItem[] {
  const rows = Papa.parse<string[]>(csv, { skipEmptyLines: true }).data;
  const items: AsiItem[] = [];
  let phase: 1 | 2 | 3 = 1;
  for (const r of rows.slice(1)) {
    const first = (r[0] ?? '').trim();
    const ph = first.match(/^PHASE\s+(\d)/i);
    if (ph) {
      phase = Number(ph[1]) as 1 | 2 | 3;
      continue;
    }
    const id = Number(first);
    if (!Number.isInteger(id) || id < 1) continue;
    items.push({
      id,
      phase,
      label: clean(r[2] ?? ''),
      keyword: keywords.get(id),
      type: clean(r[3] ?? ''),
      status: emojiStatus(r[1] ?? ''),
      lastUpdated: clean(r[4] ?? '') || undefined,
      links: [r[5], r[6]].map((x) => (x ?? '').trim()).filter((x) => x.startsWith('http')),
      notes: clean(r[7] ?? '') || undefined,
    });
  }
  if (items.length !== 50) throw new Error(`ASI sheet: expected 50 items, got ${items.length}`);
  return items;
}

export function parseAsiPage(html: string) {
  const keywords = new Map<number, string>();
  for (const m of html.matchAll(/\{id:\s*(\d+),\s*status:\s*"(\w+)",\s*type:\s*"[^"]*",\s*keyword:\s*"([^"]*)"/g)) {
    keywords.set(Number(m[1]), m[3].replace(/\\n/g, ' '));
  }
  const $ = cheerio.load(html);
  const tables = $('table').toArray();
  const logTable = tables.find((t) => clean($(t).find('thead').text()).includes('Indicator item'));
  const log: AsiData['log'] = [];
  if (logTable) {
    $(logTable)
      .find('tbody > tr')
      .each((_, tr) => {
        const tds = $(tr).children('td');
        if (tds.length < 3) return;
        const date = parseAlanDate(clean($(tds[0]).text()));
        if (!date) return;
        const ind = $(tds[1]).text();
        const ids = [...ind.matchAll(/(🟢|🟠|⚪|⚫)?\s*#(\d+)/g)].map((m) => ({ id: Number(m[2]), status: emojiStatus(m[1] ?? '') }));
        const cell = $(tds[2]);
        const title = clean(cell.find('strong').first().text());
        log.push({ date, ids, title, summary: clean(cell.text()).slice(title.length).trim().slice(0, 700), links: tds.length > 3 ? links($, $(tds[3])) : [] });
      });
  }
  const discTable = tables.find((t) => clean($(t).find('thead').text()).includes('Discovery'));
  const discoveries: AsiData['discoveries'] = [];
  if (discTable) {
    $(discTable)
      .find('tbody > tr')
      .each((_, tr) => {
        const tds = $(tr).children('td');
        if (tds.length < 5) return;
        discoveries.push({
          n: Number(clean($(tds[0]).text())) || discoveries.length + 1,
          model: clean($(tds[1]).text()),
          discovery: clean($(tds[2]).text()),
          org: clean($(tds[3]).text()),
          date: parseAlanDate(clean($(tds[4]).text())) ?? clean($(tds[4]).text()),
          url: $(tds[4]).find('a').attr('href') ?? undefined,
        });
      });
  }
  return { keywords, log, discoveries };
}

export function parseAsiEvents(html: string): AsiData['events'] {
  const events: AsiData['events'] = [];
  for (const m of html.matchAll(/\[\s*"([A-Za-z]{3}\/\d{4})"\s*,\s*(\d+)\s*,\s*\[([\d,\s]*)\]\s*(?:,\s*(true|1|false|0))?\s*\]/g)) {
    const date = parseAlanDate(m[1]);
    if (!date) continue;
    const ids = m[3].split(',').map((x) => Number(x.trim())).filter((x) => x > 0);
    events.push({ date, ids, achieved: m[4] === 'true' || m[4] === '1' });
  }
  if (events.length < 10) throw new Error(`ASI animation events suspiciously few (${events.length})`);
  return events;
}

export async function fetchAlan() {
  const fetchedAt = new Date().toISOString();
  const [agiHtml, asiHtml, animHtml, sheetCsv] = await Promise.all([get(AGI_URL), get(ASI_URL), get(ASI_ANIM_URL), get(ASI_SHEET_URL)]);
  const agi = { ...parseAgi(agiHtml), fetchedAt };
  const page = parseAsiPage(asiHtml);
  const asi: AsiData = {
    fetchedAt,
    items: parseAsiSheet(sheetCsv, page.keywords),
    events: parseAsiEvents(animHtml),
    log: page.log,
    discoveries: page.discoveries,
  };
  writeJson(path.join(RAW, 'alan.json'), { agi, asi }, true);
  const counts = { achieved: 0, partial: 0, none: 0 } as Record<AsiStatus, number>;
  for (const i of asi.items) counts[i.status]++;
  writeJson(path.join(SNAPSHOTS, 'alan', `${today()}.json`), { fetchedAt, agi: agi.value, lastUpdate: agi.lastUpdate, asi: counts }, true);
  return `AGI ${agi.value}% (${agi.lastUpdate}), ${agi.log.length} log rows · ASI ${counts.achieved}/${counts.partial}/${counts.none}, ${asi.events.length} events, ${asi.log.length} evidence rows`;
}
