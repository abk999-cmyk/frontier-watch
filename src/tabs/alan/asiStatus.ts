import type { AsiData, AsiItem, AsiStatus } from '../../../shared/types.ts';

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** Alan's "Last updated" cells are "2025", "May/2026" or blank → ISO month start, or null. */
export function parseLoose(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(/([A-Za-z]{3})[a-z]*\s*\/\s*(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[2]}-${MONTHS[m[1].toLowerCase()]}-01`;
  const y = s.match(/(\d{4})/);
  return y ? `${y[1]}-01-01` : null;
}

const RANK: Record<AsiStatus, number> = { none: 0, partial: 1, achieved: 2 };

/**
 * Reconstruct every indicator's status as of `asOf` (ISO date) from Alan's event
 * log, capped at today's status (the sheet is authoritative for "now").
 * `asOf = null` returns today's status.
 */
export function statusesAt(items: AsiItem[], events: AsiData['events'], asOf: string | null): Map<number, AsiStatus> {
  const out = new Map<number, AsiStatus>();
  for (const item of items) {
    if (asOf === null) {
      out.set(item.id, item.status);
      continue;
    }
    let s: AsiStatus = 'none';
    for (const e of events) {
      if (e.date > asOf || !e.ids.includes(item.id)) continue;
      if (e.achieved) s = 'achieved';
      else if (s === 'none') s = 'partial';
    }
    if (s === 'none' && item.status !== 'none') {
      const lu = parseLoose(item.lastUpdated);
      if (lu && lu <= asOf) s = 'partial';
    }
    out.set(item.id, RANK[s] > RANK[item.status] ? item.status : s);
  }
  return out;
}

/** Our own derived progress score (Alan publishes none): achieved = 1, partial = 0.5. */
export function asiScore(statuses: Map<number, AsiStatus>): number {
  let s = 0;
  for (const v of statuses.values()) s += v === 'achieved' ? 1 : v === 'partial' ? 0.5 : 0;
  return statuses.size ? (s / statuses.size) * 100 : 0;
}

/** Monthly checkpoints spanning the event log, for the replay scrubber. */
export function replayMonths(events: AsiData['events'], end: string): string[] {
  const first = events.map((e) => e.date).sort()[0] ?? end;
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
