// Pure filter logic for the Charts Lab (no React): global model scope, table sort/search,
// and the Breakthroughs / Spending facet filters. Tested in filterModel.test.ts.

import type { EciPoint, LabGroup, MetrPoint, Model } from '../../../shared/types.ts';
import { inRange, isDateActive, isRangeActive, matchAny, matchDate, summarizeDate, textMatch, type DateFilterValue, type RangeValue } from '../../lib/filters.ts';
import { isoFromTime } from '../../lib/format.ts';
import { LAB_GROUPS } from '../../lib/labs.ts';
import { qStart, type Breakthrough, type Commitment } from './cbData.ts';

const GROUP_ORDER: LabGroup[] = [...LAB_GROUPS, 'other'];

/** Case/punctuation-insensitive model name, so "GPT-5.1" and "gpt 5.1" meet. */
export const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ── Global model scope ──────────────────────────────────────────────────────
export type Weights = 'all' | 'open' | 'closed';
export type ModelMode = 'highlight' | 'only';

/** Anything that names a model: registry id when known, display name always, open-weights flag when the source carries one. */
export interface ModelRef {
  modelId?: string | null;
  name: string;
  open?: boolean | null;
}

export interface ModelOption {
  /** registry id, or `n:<normalised name>` for models Epoch/METR rate that aren't in the registry */
  key: string;
  modelId?: string;
  label: string;
  g: LabGroup;
  date: string | null;
  open: boolean | null;
}

export interface ModelIndex {
  options: ModelOption[];
  openById: Map<string, boolean | null>;
  openByName: Map<string, boolean>;
  /** registry id → normalised registry name */
  nameById: Map<string, string>;
}

/** One searchable list of every model the lab's charts can show (registry ∪ ECI ∪ METR), plus open-weights lookups. */
export function buildModelIndex(models: Model[], eci: EciPoint[], metr: MetrPoint[]): ModelIndex {
  const opts = new Map<string, ModelOption>();
  const openById = new Map<string, boolean | null>();
  const openByName = new Map<string, boolean>();
  const nameById = new Map<string, string>();
  const idByName = new Map<string, string>();
  for (const m of models) {
    const n = normName(m.name);
    nameById.set(m.id, n);
    idByName.set(n, m.id);
    openById.set(m.id, m.openWeights ?? null);
    if (m.openWeights != null) openByName.set(n, m.openWeights);
    opts.set(m.id, { key: m.id, modelId: m.id, label: m.name, g: m.labGroup, date: m.released ?? null, open: m.openWeights ?? null });
  }
  const addLoose = (p: { name: string; modelId?: string; labGroup: LabGroup; date: string }, open: boolean | null) => {
    const n = normName(p.name);
    if (open != null && !openByName.has(n)) openByName.set(n, open);
    const id = p.modelId ?? idByName.get(n);
    if (id && opts.has(id)) {
      // The registry doesn't always say; Epoch does.
      if (open != null && openById.get(id) == null) {
        openById.set(id, open);
        opts.get(id)!.open = open;
      }
      return;
    }
    const key = `n:${n}`;
    if (!opts.has(key)) opts.set(key, { key, label: p.name, g: p.labGroup, date: p.date, open });
  };
  for (const p of eci) addLoose(p, p.open);
  for (const p of metr) addLoose(p, null);
  const options = [...opts.values()].sort(
    (a, b) => GROUP_ORDER.indexOf(a.g) - GROUP_ORDER.indexOf(b.g) || (b.date ?? '').localeCompare(a.date ?? '') || a.label.localeCompare(b.label),
  );
  return { options, openById, openByName, nameById };
}

/** true = open weights, false = closed, null = unknown. Registry beats the source's own flag beats a name match. */
export function resolveOpen(ref: ModelRef, idx: ModelIndex): boolean | null {
  const byId = ref.modelId ? idx.openById.get(ref.modelId) : undefined;
  if (byId != null) return byId;
  if (typeof ref.open === 'boolean') return ref.open;
  return idx.openByName.get(normName(ref.name)) ?? null;
}

/** Unknown openness never passes an open/closed filter: we don't guess. */
export const matchWeights = (open: boolean | null, w: Weights) => w === 'all' || (open !== null && open === (w === 'open'));

export interface Selection {
  ids: Set<string>;
  names: Set<string>;
  size: number;
}

export function selectionOf(keys: string[], idx: ModelIndex): Selection {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const k of keys) {
    if (k.startsWith('n:')) names.add(k.slice(2));
    else {
      ids.add(k);
      const n = idx.nameById.get(k);
      if (n) names.add(n);
    }
  }
  return { ids, names, size: keys.length };
}

export const isSelected = (ref: ModelRef, sel: Selection) => sel.size > 0 && ((!!ref.modelId && sel.ids.has(ref.modelId)) || sel.names.has(normName(ref.name)));

/** Inclusive date test for ISO strings or epoch ms; undated items survive only when the filter is off. */
export function inDate(d: string | number | null | undefined, f: DateFilterValue): boolean {
  if (!isDateActive(f)) return true;
  if (d == null || d === '') return false;
  if (typeof d === 'number') return Number.isFinite(d) && matchDate(isoFromTime(d), f);
  return matchDate(d, f);
}

export interface ScopeState {
  labs: ReadonlySet<LabGroup>;
  date: DateFilterValue;
  weights: Weights;
  mode: ModelMode;
  sel: Selection;
}

/** Does a model-bearing point pass every global filter? (Highlight mode never removes points.) */
export function inScope(p: ModelRef & { g: LabGroup; date?: string | number | null }, s: ScopeState, idx: ModelIndex): boolean {
  return s.labs.has(p.g) && inDate(p.date, s.date) && matchWeights(resolveOpen(p, idx), s.weights) && (s.mode !== 'only' || !s.sel.size || isSelected(p, s.sel));
}

export const optionRef = (o: ModelOption) => ({ modelId: o.modelId, name: o.label, open: o.open, g: o.g, date: o.date });

// ── Table sort + search ─────────────────────────────────────────────────────
export type SortDir = 'asc' | 'desc';
export type SortValue = string | number | null | undefined;
export interface SortState {
  key: string;
  dir: SortDir;
}

const isBlank = (v: SortValue) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));

/** Stable sort; blanks always sink to the bottom whatever the direction; strings compare naturally ("GPT-5" < "GPT-10"). */
export function sortRows<T>(rows: readonly T[], get: (r: T) => SortValue, dir: SortDir): T[] {
  const d = dir === 'asc' ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: get(r) }))
    .sort((a, b) => {
      const na = isBlank(a.v);
      const nb = isBlank(b.v);
      if (na || nb) return na && nb ? a.i - b.i : na ? 1 : -1;
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: 'base' });
      return c * d || a.i - b.i;
    })
    .map((x) => x.r);
}

/** Click cycle for a header: same column flips; a new column starts ascending for text, descending for numbers. */
export function nextSort(cur: SortState | null, key: string, sample: SortValue): SortState {
  if (cur?.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: typeof sample === 'string' ? 'asc' : 'desc' };
}

export const searchRows = <T>(rows: readonly T[], hay: (r: T) => string, q: string): T[] => (q.trim() ? rows.filter((r) => textMatch(hay(r), q)) : [...rows]);

// ── Active-filter pill labels ───────────────────────────────────────────────
export interface Pill {
  key: string;
  label: string;
  onClear: () => void;
}

export function listSummary(values: string[], nameOf: (v: string) => string, max = 2): string {
  const names = values.map(nameOf);
  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', ');
}

export const multiPill = (key: string, label: string, values: string[], nameOf: (v: string) => string, onClear: () => void): Pill | null =>
  values.length ? { key, label: `${label}: ${listSummary(values, nameOf)}`, onClear } : null;
export const datePill = (key: string, label: string, v: DateFilterValue, onClear: () => void): Pill | null => (isDateActive(v) ? { key, label: `${label}: ${summarizeDate(v)}`, onClear } : null);
export const rangePill = (key: string, label: string, v: RangeValue, domain: [number, number], fmt: (n: number) => string, onClear: () => void): Pill | null =>
  isRangeActive(v) ? { key, label: `${label}: ${fmt(v.min ?? domain[0])}–${fmt(v.max ?? domain[1])}`, onClear } : null;
export const textPill = (key: string, q: string, onClear: () => void): Pill | null => (q.trim() ? { key, label: `“${q.trim()}”`, onClear } : null);
export const compact = (xs: (Pill | null | false | undefined)[]): Pill[] => xs.filter((x): x is Pill => !!x);

/** Integer [floor, ceil] domain over finite values, with a fallback when there are none. */
export function numDomain(values: (number | null | undefined)[], fallback: [number, number] = [0, 1]): [number, number] {
  const xs = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!xs.length) return fallback;
  const lo = Math.floor(Math.min(...xs));
  const hi = Math.ceil(Math.max(...xs));
  return [lo, hi > lo ? hi : lo + 1];
}

// ── Breakthroughs ───────────────────────────────────────────────────────────
export interface BtFilter {
  q: string;
  date: DateFilterValue;
  domains: string[];
  fields: string[];
  orgs: string[];
  models: string[];
  tags: string[];
  sig: RangeValue;
  verifs: string[];
  autonomy: string[];
}
export type BtFacet = 'domains' | 'fields' | 'orgs' | 'models' | 'tags' | 'verifs' | 'autonomy' | 'sig' | 'date' | 'q';

export const BT_EMPTY: BtFilter = { q: '', date: { mode: 'any' }, domains: [], fields: [], orgs: [], models: [], tags: [], sig: {}, verifs: [], autonomy: [] };

/** "combinatorics / number theory" counts under both fields. */
export const btFields = (b: Breakthrough) => (b.field ? b.field.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean) : []);
export const btModel = (b: Breakthrough) => b.model ?? b.system;
export const btAutonomy = (b: Breakthrough) => b.autonomy ?? 'unstated';
export const btHaystack = (b: Breakthrough) => [b.title, b.summary, b.field, b.system, b.model, b.org, b.problem, ...b.tags].filter(Boolean).join(' ');

/** Every filter except `skip` (so a facet's option counts reflect the other filters). */
export function matchBreakthrough(b: Breakthrough, f: BtFilter, skip?: BtFacet): boolean {
  return (
    (skip === 'q' || textMatch(btHaystack(b), f.q)) &&
    (skip === 'date' || matchDate(b.date, f.date)) &&
    (skip === 'domains' || matchAny(b.domain, f.domains)) &&
    (skip === 'fields' || matchAny(btFields(b), f.fields)) &&
    (skip === 'orgs' || matchAny(b.org, f.orgs)) &&
    (skip === 'models' || matchAny(btModel(b), f.models)) &&
    (skip === 'tags' || matchAny(b.tags, f.tags)) &&
    (skip === 'sig' || inRange(b.significance, f.sig)) &&
    (skip === 'verifs' || matchAny(b.verification, f.verifs)) &&
    (skip === 'autonomy' || matchAny(btAutonomy(b), f.autonomy))
  );
}
export const filterBreakthroughs = (items: Breakthrough[], f: BtFilter, skip?: BtFacet) => items.filter((b) => matchBreakthrough(b, f, skip));
export const btActive = (f: BtFilter) =>
  !!f.q.trim() || isDateActive(f.date) || isRangeActive(f.sig) || [f.domains, f.fields, f.orgs, f.models, f.tags, f.verifs, f.autonomy].some((x) => x.length > 0);

// ── Spending ────────────────────────────────────────────────────────────────
/** A calendar quarter matches a date filter when any day of it falls inside the window. */
export function quarterMatches(q: number, f: DateFilterValue): boolean {
  if (!isDateActive(f)) return true;
  const start = isoFromTime(qStart(q));
  const end = isoFromTime(qStart(q + 1) - 864e5);
  if (f.mode === 'before') return !f.to || start <= f.to;
  if (f.mode === 'after') return !f.from || end >= f.from;
  return (!f.to || start <= f.to) && (!f.from || end >= f.from);
}

export interface CommitFilter {
  q: string;
  date: DateFilterValue;
  companies: string[];
  statuses: string[];
  counterparties: string[];
  size: RangeValue;
}
export type CommitFacet = 'q' | 'date' | 'companies' | 'statuses' | 'counterparties' | 'size';
export const COMMIT_EMPTY: CommitFilter = { q: '', date: { mode: 'any' }, companies: [], statuses: [], counterparties: [], size: {} };

export const commitHaystack = (c: Commitment) => [c.title, c.company, ...c.counterparties, c.horizon, c.note].filter(Boolean).join(' ');

export function matchCommitment(c: Commitment, f: CommitFilter, skip?: CommitFacet): boolean {
  return (
    (skip === 'q' || textMatch(commitHaystack(c), f.q)) &&
    (skip === 'date' || matchDate(c.date, f.date)) &&
    (skip === 'companies' || matchAny(c.company, f.companies)) &&
    (skip === 'statuses' || matchAny(c.status, f.statuses)) &&
    (skip === 'counterparties' || matchAny(c.counterparties, f.counterparties)) &&
    (skip === 'size' || inRange(c.usdBillions, f.size))
  );
}
export const filterCommitments = (items: Commitment[], f: CommitFilter, skip?: CommitFacet) => items.filter((c) => matchCommitment(c, f, skip));
