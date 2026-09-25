// Pure geometry for the AI 2027 track: time scale, rails, node stacking and label lanes.
import { fmtLag, monthsBetween, type ProxyLag } from './lag.ts';
import type { Branch, Milestone, Proxy } from './types.ts';
import { clip, shortTitle } from './ui.tsx';

export const DOMAIN_START = '2025-04-01';
export const DOMAIN_END = '2030-07-01';
export const PAD_L = 40;
export const OVERFLOW = 70; // axis-break zone for anything after DOMAIN_END (e.g. 2035)
export const PAD_R = 30;
export const MIN_PPM = 16; // px per month floor → horizontal scroll on phones

export const Y = { axis: 14, shared: 176, race: 116, slowdown: 236, reality: 352, height: 456 } as const;
export const NODE_R = 7;
const STACK_STEP = 22;
const CHAR_W = 6.0; // ≈ Geist 11px average advance
const LABEL_GAP = 10;

export interface Lane {
  y: number;
  /** label must end before the fork (lanes that sit between the shared and race rails) */
  preFork?: boolean;
}

// Lane sets per (rail, stacked?). Same y = same lane, so occupancy is shared automatically.
const LANES: Record<Branch, { primary: Lane[]; stacked: Lane[] }> = {
  shared: {
    primary: [{ y: 150, preFork: true }, { y: 134, preFork: true }, { y: 96 }, { y: 80 }, { y: 64 }, { y: 48 }],
    stacked: [{ y: 218, preFork: true }, { y: 234, preFork: true }],
  },
  race: { primary: [{ y: 96 }, { y: 80 }, { y: 64 }, { y: 48 }], stacked: [{ y: 158 }, { y: 174 }] },
  slowdown: { primary: [{ y: 262 }, { y: 278 }, { y: 294 }], stacked: [{ y: 200 }, { y: 186 }] },
};
const REALITY_LANES: Lane[] = [{ y: 378 }, { y: 394 }, { y: 410 }, { y: 426 }, { y: 442 }];

export interface Label {
  x: number;
  y: number;
  anchor: 'start' | 'end';
  text: string;
  /** leader line from the node edge to the label */
  lx: number;
  ly1: number;
  ly2: number;
}

export interface TrackNode {
  m: Milestone;
  x: number;
  y: number;
  railY: number;
  stacked: boolean;
  label: Label | null;
}

export interface ProxyGeom {
  p: Proxy;
  lag: ProxyLag;
  sx: number;
  sy: number;
  ex: number | null;
  ey: number;
  label: Label | null;
}

export interface Scale {
  ppm: number;
  width: number;
  x: (d: string) => number;
  endX: number;
  overflowX: number;
}

export function makeScale(containerWidth: number, zoom: number): Scale {
  const months = monthsBetween(DOMAIN_START, DOMAIN_END);
  const fit = (containerWidth - PAD_L - OVERFLOW - PAD_R) / months;
  const ppm = Math.max(MIN_PPM, fit) * zoom;
  const endX = PAD_L + months * ppm;
  const overflowX = endX + OVERFLOW * 0.62;
  const x = (d: string) => {
    if (d > DOMAIN_END) return overflowX;
    return PAD_L + Math.max(0, monthsBetween(DOMAIN_START, d)) * ppm;
  };
  return { ppm, width: Math.ceil(endX + OVERFLOW + PAD_R), x, endX, overflowX };
}

type Interval = [number, number];
interface Placed {
  y: number;
  x: number;
  anchor: 'start' | 'end';
  span: Interval;
}
class LaneBook {
  private occ = new Map<number, Interval[]>();
  constructor(private width: number, private forkX: number) {}
  reserve(y: number, span: Interval) {
    const list = this.occ.get(y) ?? [];
    list.push(span);
    this.occ.set(y, list);
  }
  release(y: number, span: Interval) {
    const list = this.occ.get(y) ?? [];
    const i = list.indexOf(span);
    if (i >= 0) list.splice(i, 1);
  }
  place(nodeX: number, text: string, lanes: Lane[]): Placed | null {
    const w = text.length * CHAR_W + 2;
    for (const lane of lanes) {
      let anchor: 'start' | 'end' = 'start';
      let a = nodeX - 4;
      let b = a + w;
      if (b > this.width - 4) {
        anchor = 'end';
        b = nodeX + 4;
        a = b - w;
      }
      if (a < 2) continue;
      if (lane.preFork && b > this.forkX - 8) continue;
      const list = this.occ.get(lane.y) ?? [];
      if (list.some(([p, q]) => a < q + LABEL_GAP && b > p - LABEL_GAP)) continue;
      const span: Interval = [a, b];
      this.reserve(lane.y, span);
      return { y: lane.y, x: anchor === 'start' ? a : b, anchor, span };
    }
    return null;
  }
}

interface Want {
  x: number;
  lanes: Lane[];
  /** longest first; the last one is the minimal label */
  variants: string[];
}
/**
 * Coverage first, detail second: every item gets its minimal label where any lane has room,
 * then each one upgrades to a longer variant in its own lane if that still fits.
 */
function placeLabels(book: LaneBook, wants: Want[]): ({ got: Placed; text: string } | null)[] {
  const out = wants.map((w) => {
    const text = w.variants[w.variants.length - 1];
    const got = book.place(w.x, text, w.lanes);
    return got ? { got, text } : null;
  });
  wants.forEach((w, i) => {
    const cur = out[i];
    if (!cur) return;
    const lane = w.lanes.find((l) => l.y === cur.got.y)!;
    for (const text of w.variants.slice(0, -1)) {
      book.release(cur.got.y, cur.got.span);
      const got = book.place(w.x, text, [lane]);
      if (got) {
        out[i] = { got, text };
        return;
      }
      book.reserve(cur.got.y, cur.got.span);
    }
  });
  return out;
}

export interface Layout {
  scale: Scale;
  forkX: number | null;
  nodes: TrackNode[];
  proxies: ProxyGeom[];
  railEnds: Record<Branch, { from: number; to: number } | null>;
  nowX: number;
}

export function layoutTrack(milestones: Milestone[], proxies: Proxy[], lags: ProxyLag[], now: string, scale: Scale): Layout {
  const { x } = scale;
  const shared = milestones.filter((m) => m.branch === 'shared');
  const branchDates = milestones.filter((m) => m.branch !== 'shared').map((m) => m.date);
  // The fork is the last shared milestone (AI 2027: Oct 2027, "Government Oversight").
  const forkDate = shared.length ? shared.reduce((a, m) => (m.date > a ? m.date : a), shared[0].date) : branchDates.sort()[0] ?? null;
  const forkX = forkDate ? x(forkDate) : null;
  // Branches split vertically at the fork date (git-graph style), so every node keeps its true x.
  const railY = (b: Branch) => Y[b];

  // Position + stack coincident nodes on the rail's free side.
  const order = [...milestones].sort((a, b) => a.date.localeCompare(b.date));
  const placed: TrackNode[] = [];
  for (const m of order) {
    const nx = x(m.date);
    const ry = railY(m.branch);
    const same = placed.filter((n) => n.m.branch === m.branch && Math.abs(n.x - nx) < NODE_R * 2 - 2);
    const k = same.length;
    const dir = m.branch === 'slowdown' ? -1 : 1;
    placed.push({ m, x: nx, y: ry + dir * k * STACK_STEP, railY: ry, stacked: k > 0, label: null });
  }

  // Labels: primary nodes first (in time order per rail), then stacked ones.
  const book = new LaneBook(scale.width, forkX ?? scale.width);
  if (forkX != null) {
    book.reserve(234, [forkX - 118, forkX - 4]); // "slowdown" tag
  }
  const rank = (b: Branch) => (b === 'shared' ? 0 : b === 'race' ? 1 : 2);
  const byRail = [...placed].sort((a, b) => Number(a.stacked) - Number(b.stacked) || rank(a.m.branch) - rank(b.m.branch) || a.x - b.x);
  placeLabels(
    book,
    byRail.map((n) => ({ x: n.x, lanes: n.stacked ? LANES[n.m.branch].stacked : LANES[n.m.branch].primary, variants: [shortTitle(n.m.title, 30), shortTitle(n.m.title, 16)] })),
  ).forEach((r, i) => {
    if (!r) return;
    const n = byRail[i];
    const above = r.got.y < n.y;
    n.label = {
      x: r.got.x,
      y: r.got.y,
      anchor: r.got.anchor,
      text: r.text,
      lx: n.x,
      ly1: above ? n.y - NODE_R - 2 : n.y + NODE_R + 2,
      ly2: above ? r.got.y + 4 : r.got.y - 11,
    };
  });

  // Proxies: scenario tick on the rail → reality node on the reality rail.
  const msById = new Map(milestones.map((m) => [m.id, m]));
  const pg: ProxyGeom[] = proxies.map((p, i) => {
    const lag = lags[i];
    const ref = p.scenarioRef ? msById.get(p.scenarioRef) : undefined;
    const onBranch = ref && ref.branch !== 'shared' && forkDate != null && p.scenarioDate > forkDate;
    const sy = onBranch ? Y[ref!.branch] : Y.shared;
    const sx = x(p.scenarioDate);
    // Every reality node sits ON the reality rail; coincident dates are dodged sideways below.
    return { p, lag, sx, sy, ex: lag.endDate ? x(lag.endDate) : null, ey: Y.reality, label: null };
  });
  dodgeOnRail(pg.filter((g) => g.ex != null));
  // Reality labels: lag first (it's the point), then a short name; fall back to the lag alone.
  const rbook = new LaneBook(scale.width, scale.width);
  const ordered = pg.filter((g) => g.ex != null).sort((a, b) => a.ex! - b.ex! || b.p.weight - a.p.weight);
  const variants = (g: ProxyGeom) => {
    const lag = fmtLag(g.lag.months, g.lag.atLeast).replace(' mo', '');
    const proj = g.lag.kind === 'projected';
    const name = g.p.name.replace(/\s*\([^)]*\)/g, '');
    return [`${lag}${proj ? ' projected' : ''} · ${clip(name, 24)}`, `${lag}${proj ? ' proj.' : ''} · ${clip(name, 12)}`, `${lag}${proj ? ' proj.' : ''}`];
  };
  placeLabels(
    rbook,
    ordered.map((g) => ({ x: g.ex!, lanes: REALITY_LANES, variants: variants(g) })),
  ).forEach((r, i) => {
    if (!r) return;
    const g = ordered[i];
    g.label = { x: r.got.x, y: r.got.y, anchor: r.got.anchor, text: r.text, lx: g.ex!, ly1: Y.reality + NODE_R, ly2: r.got.y - 11 };
  });

  const extent = (b: Branch) => {
    const xs = placed.filter((n) => n.m.branch === b).map((n) => n.x);
    if (!xs.length) return null;
    return { from: b === 'shared' ? PAD_L : forkX ?? Math.min(...xs), to: Math.max(...xs) };
  };
  return {
    scale,
    forkX,
    nodes: placed,
    proxies: pg,
    railEnds: { shared: extent('shared'), race: extent('race'), slowdown: extent('slowdown') },
    nowX: x(now),
  };
}

/**
 * 1-D dodge along the reality rail: nodes closer than one diameter are spread sideways, each
 * cluster centred on the mean of its true positions, so dots never leave the rail. The true
 * date stays in the label and tooltip; the offset is at most a few node widths.
 */
export function dodgeOnRail(nodes: { ex: number | null }[]) {
  const MIN = NODE_R * 2 + 3;
  const items = nodes.map((n) => ({ n, t: n.ex as number })).sort((a, b) => a.t - b.t);
  let i = 0;
  while (i < items.length) {
    // Grow a cluster while the next node would overlap the packed run.
    let j = i;
    while (j + 1 < items.length && items[j + 1].t - items[i].t < (j + 1 - i + 1) * MIN) j++;
    const k = j - i + 1;
    const mean = items.slice(i, j + 1).reduce((a, it) => a + it.t, 0) / k;
    for (let q = 0; q < k; q++) items[i + q].n.ex = mean + (q - (k - 1) / 2) * MIN;
    i = j + 1;
  }
  // Clusters may now touch their neighbours; one left-to-right pass keeps the minimum gap.
  for (let q = 1; q < items.length; q++) {
    const prev = items[q - 1].n.ex as number;
    if ((items[q].n.ex as number) - prev < MIN) items[q].n.ex = prev + MIN;
  }
}

/** S-curve between two points (vertical tangents at both ends). */
export function connector(x1: number, y1: number, x2: number, y2: number): string {
  const k = (y2 - y1) * 0.55;
  return `M${x1.toFixed(1)},${y1.toFixed(1)} C${x1.toFixed(1)},${(y1 + k).toFixed(1)} ${x2.toFixed(1)},${(y2 - k).toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
}
