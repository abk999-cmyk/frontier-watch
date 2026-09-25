/**
 * Index every source URL the dashboard uses → public/data/references.json (the References tab).
 *
 *   npx tsx scripts/build-references.ts      (npm run build:refs; `npm run refresh` runs it after build:data)
 *
 * Inputs
 *   - Live feeds: the URL constants in scripts/fetch/*.ts, read from source so this never drifts from the fetchers.
 *   - Curated YAML: every http(s) string under data/curated/**, whatever the key (url, evidenceUrl, headlineUrl,
 *     figureImage, sources[], …), including URLs mentioned inside notes. Objects marked `status: 4xx` are dead
 *     endpoints kept only as a warning in the YAML, so their URLs are skipped.
 *   - Fetched bundles written by build-data: Epoch per-row source links in public/data/scores.json (collapsed per
 *     leaderboard; the thousands of logs.epoch.ai viewer links become one entry) and the evidence links inside
 *     public/data/alan.json.
 */
import path from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { CURATED, OUT, ROOT, SNAPSHOTS } from './lib/paths.ts';
import { readJson, readYaml, writeJson } from './lib/io.ts';
import type { AlanData, ScoresData } from '../shared/types.ts';
import { canonical, classify, fallbackTitle, hostKey, parseUrl, urlKey, urlsIn } from '../src/tabs/references/classify.ts';
import {
  KINDS, SECTIONS, type Citation, type Feed, type Kind, type Origin, type Ref, type RefsData, type Section, type Usage,
} from '../src/tabs/references/types.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const str = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : String(v));
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const isUrlStr = (v: unknown) => typeof v === 'string' && /^https?:\/\/\S+$/.test(v.trim());
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (d: string) => (/^\d{4}-\d{2}/.test(d) ? `${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : d);
const warnings: string[] = [];

// ── Accumulator ────────────────────────────────────────────────────────────
interface Acc {
  url: string;
  title: string;
  titlePri: number;
  kind?: Kind;
  hints: Map<Kind, number>;
  usages: Map<string, Usage>;
  count: number;
  origins: Set<Origin>;
  grouped?: number;
}
interface Hit {
  section: Section;
  file: string;
  context: string;
  origin: Origin;
  title?: string;
  titlePri?: number;
  /** Kind to use when the URL itself is unclassifiable. */
  hint?: Kind;
  /** Kind that always wins (live feed endpoints). */
  kind?: Kind;
  /** Rows represented by this hit (Epoch groups). */
  n?: number;
  /** Override the dedupe key (host-level groups). */
  key?: string;
  grouped?: number;
}
const refs = new Map<string, Acc>();
const skipped: { url: string; file: string; reason: string }[] = [];

function add(raw: string, h: Hit) {
  const x = parseUrl(raw);
  if (!x) {
    skipped.push({ url: raw, file: h.file, reason: 'unparseable URL' });
    return;
  }
  const key = h.key ?? urlKey(x);
  let a = refs.get(key);
  if (!a) {
    a = { url: canonical(x), title: '', titlePri: -1, hints: new Map(), usages: new Map(), count: 0, origins: new Set() };
    refs.set(key, a);
  }
  const n = h.n ?? 1;
  a.count += n;
  a.origins.add(h.origin);
  if (h.kind) a.kind = h.kind;
  if (h.hint) a.hints.set(h.hint, (a.hints.get(h.hint) ?? 0) + n);
  if (h.grouped) a.grouped = h.grouped;
  const title = h.title ? clip(h.title.replace(/^["“]|["”]$/g, ''), 140) : '';
  if (title && !isUrlStr(title) && (h.titlePri ?? 0) > a.titlePri) {
    a.title = title;
    a.titlePri = h.titlePri ?? 0;
  }
  const context = clip(h.context, 200);
  const uk = `${h.section}|${h.file}|${context}`;
  const prev = a.usages.get(uk);
  if (prev) prev.n = (prev.n ?? 1) + n;
  else a.usages.set(uk, n > 1 ? { section: h.section, file: h.file, context, n } : { section: h.section, file: h.file, context });
}

// ── Lookups from the registry ──────────────────────────────────────────────
const cur = (f: string) => path.join(CURATED, f);
const modelsRaw = (readYaml<Obj[]>(cur('models.yaml')) ?? []).filter(isObj);
const modelName = new Map(modelsRaw.map((m) => [str(m.id), str(m.name) || str(m.id)]));
const benchName = new Map<string, string>();
for (const b of (readYaml<Obj[]>(cur('benchmarks.yaml')) ?? []).filter(isObj)) benchName.set(str(b.id), str(b.name));
// scores/*.yaml may declare extra benchmarks (same rule as build-data: first declaration wins).
for (const f of existsSync(cur('scores')) ? readdirSync(cur('scores')).filter((x) => x.endsWith('.yaml')).sort() : []) {
  const nb = readYaml<Obj>(cur(`scores/${f}`))?.newBenchmarks;
  if (Array.isArray(nb)) for (const b of nb.filter(isObj)) if (!benchName.has(str(b.id))) benchName.set(str(b.id), str(b.name));
}
const ORG: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', xai: 'xAI', deepseek: 'DeepSeek', alibaba: 'Alibaba', moonshot: 'Moonshot',
  zhipu: 'Zhipu', microsoft: 'Microsoft', amazon: 'Amazon', meta: 'Meta', oracle: 'Oracle', nvidia: 'Nvidia', softbank: 'SoftBank',
};
const org = (s: unknown) => ORG[str(s)] ?? str(s).charAt(0).toUpperCase() + str(s).slice(1);
const CAPEX_CO: Record<string, string> = { ...ORG, google: 'Alphabet' };

// ── 1. Live feeds (read URL constants straight from the fetchers) ──────────
const FETCH_DIR = path.join(ROOT, 'scripts/fetch');
/** Resolve `const NAME = '…'` / `` `${BASE}/…` `` constants and inline URL literals in one fetcher file. */
function fetcherUrls(file: string) {
  const src = readFileSync(path.join(FETCH_DIR, file), 'utf8');
  const consts = new Map<string, string>();
  for (const m of src.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*(['`])([^'`]*)\2/g)) {
    consts.set(m[1], m[3].replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, k) => consts.get(k) ?? `\${${k}}`));
  }
  const all = new Set<string>([...consts.values()].filter((v) => /^https?:\/\//.test(v)));
  for (const m of src.matchAll(/(['`])(https?:\/\/[^'`$]+)\1/g)) all.add(m[2]);
  // A constant that only serves as a prefix for others (e.g. a repo BASE) isn't an endpoint on its own.
  const urls = [...all].filter((u) => ![...all].some((o) => o !== u && o.startsWith(`${u}/`)));
  return { consts, urls };
}
function lastFetched(dir: string): string | undefined {
  const d = path.join(SNAPSHOTS, dir);
  if (!existsSync(d)) return undefined;
  const latest = readdirSync(d).filter((f) => f.endsWith('.json')).sort().at(-1);
  return latest ? readJson<{ fetchedAt?: string }>(path.join(d, latest))?.fetchedAt : undefined;
}

interface EndpointDef {
  const: string;
  label: string;
  format: string;
  powers: [Section, string][];
}
interface FeedDef extends Omit<Feed, 'endpoints' | 'sections' | 'lastFetched'> {
  /** Title for the homepage URL (the attribution target), which differs from the feed's name. */
  homepageTitle: string;
  file: string;
  snapshots: string;
  endpoints: EndpointDef[];
}
const FEEDS: FeedDef[] = [
  {
    id: 'epoch',
    name: 'Epoch AI Benchmarking Hub',
    org: 'Epoch AI',
    homepage: 'https://epoch.ai/benchmarks',
    homepageTitle: 'Epoch AI Benchmarking Hub',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    file: 'epoch.ts',
    fetcher: 'scripts/fetch/epoch.ts',
    snapshots: 'epoch',
    note: 'The independent backbone: Epoch runs or collects every benchmark in the hub, so these scores are marked "independent".',
    endpoints: [
      {
        const: 'ZIP_URL',
        label: 'Benchmark data bundle',
        format: 'ZIP · ~90 CSVs',
        powers: [
          ['Benchmarks', 'Independent scores for the benchmark matrix (per-benchmark CSVs)'],
          ['Benchmarks', 'Epoch Capabilities Index (ECI) with confidence intervals'],
          ['Charts Lab', 'ECI and METR time-horizon trends (METR mirror CSV)'],
          ['Charts Lab', 'Reasoning effort, tokens and cost-per-task points'],
          ['Registry', 'Training-compute estimates for the model registry'],
        ],
      },
    ],
  },
  {
    id: 'alan',
    name: 'LifeArchitect.ai AGI countdown & ASI checklist',
    org: 'Dr Alan D. Thompson',
    homepage: 'https://lifearchitect.ai/agi/',
    homepageTitle: 'LifeArchitect.ai · AGI countdown',
    license: 'Free to use with citation',
    file: 'alan.ts',
    fetcher: 'scripts/fetch/alan.ts',
    snapshots: 'alan',
    note: "One analyst's editorial judgement, shown as such: the gauge and checklist statuses are Alan's calls, not measurements.",
    endpoints: [
      { const: 'AGI_URL', label: 'AGI countdown page', format: 'HTML (scraped)', powers: [['Countdown', 'AGI gauge %, its history and the countdown log']] },
      { const: 'ASI_URL', label: 'ASI checklist page', format: 'HTML (scraped)', powers: [['Countdown', 'ASI evidence log, AI-discoveries table and milestone keywords']] },
      { const: 'ASI_ANIM_URL', label: 'ASI animation', format: 'HTML · embedded JS array', powers: [['Countdown', 'Dated ASI milestone events (the checklist timeline)']] },
      { const: 'ASI_SHEET_URL', label: 'ASI checklist sheet', format: 'Google Sheet · CSV', powers: [['Countdown', '50 ASI milestones with status, type and evidence links']] },
    ],
  },
  {
    id: 'owid',
    name: 'Our World in Data · life expectancy',
    org: 'Our World in Data',
    homepage: 'https://ourworldindata.org/life-expectancy',
    homepageTitle: 'Our World in Data · Life expectancy',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    file: 'owid.ts',
    fetcher: 'scripts/fetch/owid.ts',
    snapshots: 'owid',
    note: 'OWID processes data from the Human Mortality Database, UN World Population Prospects, Riley (2005) and Zijdeman et al. (2015).',
    endpoints: [
      { const: 'RECORD_URL', label: 'Record female life expectancy', format: 'CSV (grapher)', powers: [['Charts Lab', 'LEV panel: best-country life expectancy since 1840']] },
      { const: 'REMAINING_URL', label: 'Remaining life expectancy by age', format: 'CSV (grapher, short names)', powers: [['Charts Lab', 'LEV panel: remaining life expectancy at 0, 65 and 80']] },
    ],
  },
  {
    id: 'inference-cost',
    name: 'The Plunging Price of Thought (data)',
    org: 'Epoch AI · David Roodman',
    homepage: 'https://epoch.ai/publications/the-plunging-price-of-thought',
    homepageTitle: 'Epoch AI · The Plunging Price of Thought',
    license: 'Epoch AI report data: cite the report',
    file: 'inference-cost.ts',
    fetcher: 'scripts/fetch/inference-cost.ts',
    snapshots: 'inference-cost',
    note: "Pulled from the report's public GitHub repo (droodman/inference-cost), because the CSV link on epoch.ai returns 404.",
    endpoints: [
      { const: 'RECORDS_URL', label: 'Cost-record holders (report Figure 2)', format: 'CSV (GitHub raw)', powers: [['Charts Lab', 'Cost panel: cheapest cost per task at 25% / 75% accuracy']] },
      { const: 'DECLINES_URL', label: 'Quarterly decline rates', format: 'CSV (GitHub raw)', powers: [['Charts Lab', 'Cost panel: model-free price decline per quarter, per benchmark']] },
    ],
  },
];

const feeds: Feed[] = [];
for (const f of FEEDS) {
  if (!existsSync(path.join(FETCH_DIR, f.file))) {
    warnings.push(`fetcher ${f.file} missing — feed "${f.id}" skipped`);
    continue;
  }
  const { consts, urls } = fetcherUrls(f.file);
  const endpointUrls = new Set<string>();
  const endpoints = f.endpoints.flatMap((e) => {
    const url = consts.get(e.const);
    if (!url || !/^https?:\/\//.test(url)) {
      warnings.push(`${f.file}: constant ${e.const} not found (fetcher changed?)`);
      return [];
    }
    endpointUrls.add(url);
    for (const [section, what] of e.powers) {
      add(url, { section, file: f.fetcher, context: `${e.label}: ${what}`, origin: 'fetched', title: `${f.org}: ${e.label}`, titlePri: 100, kind: 'dataset' });
    }
    return [{ label: e.label, url: canonical(parseUrl(url)!), format: e.format, powers: e.powers.map(([section, what]) => ({ section, what })) }];
  });
  // Any other URL the fetcher writes into its output (report page, repo…) is cited too.
  const sections = [...new Set(f.endpoints.flatMap((e) => e.powers.map(([s]) => s)))];
  for (const u of urls) {
    if (endpointUrls.has(u)) continue;
    add(u, { section: sections[0], file: f.fetcher, context: `${f.name}: provenance link stored with the fetched data`, origin: 'fetched' });
  }
  add(f.homepage, { section: sections[0], file: f.fetcher, context: `${f.name}: homepage (attribution)`, origin: 'fetched', title: f.homepageTitle, titlePri: 95 });
  const { file: _file, snapshots, endpoints: _e, homepageTitle: _h, ...rest } = f;
  feeds.push({ ...rest, sections, lastFetched: lastFetched(snapshots), endpoints });
}

// ── 2. Curated YAML (recursive walk) ───────────────────────────────────────
function yamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? yamlFiles(p) : /\.ya?ml$/.test(f) ? [p] : [];
    });
}

const SECTION_BY_FILE: [RegExp, Section][] = [
  [/^(scores\/|benchmarks\.yaml|scaling-vectors\.yaml)/, 'Benchmarks'],
  [/^models\.yaml/, 'Registry'],
  [/^(breakthroughs|capex|spending-commitments|lev)\.yaml/, 'Charts Lab'],
  [/^ai20(27|40)/, 'Timelines'],
  [/^alan/, 'Countdown'],
];
const unmapped = new Set<string>();
function sectionFor(rel: string, owner: Obj): Section {
  if (rel === 'data-sources.yaml') {
    // Catalogue of fetchable sources: route each entry to the module it documents.
    const id = str(owner.id);
    if (/^lifearchitect/.test(id)) return 'Countdown';
    if (/^(owid|metaculus|manifold)/.test(id) || /(inference-cost|price-trends|cost-truncated)/.test(id)) return 'Charts Lab';
    if (/all-ai-models/.test(id)) return 'Registry';
    return 'Benchmarks';
  }
  for (const [re, s] of SECTION_BY_FILE) if (re.test(rel)) return s;
  if (!unmapped.has(rel)) {
    unmapped.add(rel);
    warnings.push(`no section mapping for ${rel}; filed under Charts Lab (add it to SECTION_BY_FILE)`);
  }
  return 'Charts Lab';
}

const FIELD_NOTE: Record<string, string> = {
  url: '',
  sources: 'supporting source',
  evidenceUrl: 'evidence',
  headlineUrl: 'headline figure',
  figureImage: 'figure image',
  dataUrl: 'data file',
  data: 'data',
  endpoints: 'API endpoint',
  pdf: 'PDF',
  blog: 'blog post',
  summaryPage: 'summary page',
  source: 'source',
  epochCsvUrl: 'Epoch cross-check CSV',
  shortNamesUrl: 'short-names CSV',
};
const AREA: Record<string, string> = {
  manifold: 'Manifold market',
  metaculus: 'Metaculus',
  named: 'Named forecast',
  annotations: 'Annotation',
  candidates: 'Curve candidate',
  derived: 'Derived series',
  definition: 'Definition',
  lifeExpectancyData: 'Life-expectancy data',
  recordTrend: 'Record trend',
  pageUrls: 'Scenario page',
  authorsPaceEstimate: "Authors' pace estimate",
  milestones: 'Milestone',
  plans: 'Plan',
  stages: 'Stage',
  preconditions: 'Precondition',
  newBenchmarks: 'New benchmark',
  quarters: 'Quarter',
  guidance: 'Guidance',
};
const humanKey = (k: string) => AREA[k] ?? k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function label(o: Obj): string {
  for (const k of ['title', 'name', 'question', 'text', 'label', 'discovery']) if (typeof o[k] === 'string' && !isUrlStr(o[k])) return str(o[k]);
  if (o.who) return `${str(o.who)}${o.claim ? `: ${str(o.claim)}` : ''}`;
  return str(o.id);
}

/** Card/post wording for a model's own source link. */
function modelSourceTitle(name: string, u: string): string | undefined {
  const k = classify(u);
  const p = u.toLowerCase();
  if (/system[-_]?card|safety[-_]?report/.test(p)) return `${name} system card`;
  if (/model[-_]?card|modelcard/.test(p) || /huggingface\.co\//.test(p)) return `${name} model card`;
  if (k === 'paper') return `${name} technical report`;
  if (k === 'lab') return /\.pdf($|\?)/.test(p) ? `${name} model card` : `${name} release post`;
  return undefined;
}

interface Where {
  rel: string;
  doc: unknown;
  owner: Obj;
  field: string;
  embedded: boolean;
  trail: string[];
  stack: Obj[];
}
/** Context line (+ optional title) for one URL occurrence in a curated file. */
function describe(w: Where, url: string): Pick<Hit, 'context' | 'title' | 'titlePri' | 'hint'> {
  const { rel, owner: o, field, embedded, trail, stack } = w;
  const note = embedded ? `cited in ${humanKey(field).toLowerCase()}` : (FIELD_NOTE[field] ?? humanKey(field).toLowerCase());
  const primary = field === 'url' && !embedded;
  const withNote = (who: string) => (note ? `${who} · ${note}` : who);
  const area = trail.at(-1);
  const isRoot = stack.length === 1;

  if (rel.startsWith('scores/')) {
    // A new benchmark's url is often the system card that introduced it: only name the page after the benchmark when it isn't a lab page.
    if (area === 'newBenchmarks') return { context: withNote(`New benchmark: ${label(o)}`), title: primary && classify(url) !== 'lab' ? label(o) : undefined, titlePri: 70, hint: 'leaderboard' };
    const m = modelName.get(str(o.model)) ?? str(o.model);
    const b = benchName.get(str(o.benchmark)) ?? str(o.benchmark);
    const prov = o.provenance === 'lab' ? 'lab-reported' : 'independent';
    return {
      context: withNote(`${m} · ${b} = ${str(o.value)} (${prov})`),
      title: primary && typeof o.source === 'string' ? o.source : undefined,
      titlePri: 90,
      hint: o.provenance === 'lab' ? 'lab' : 'leaderboard',
    };
  }
  if (rel === 'models.yaml') {
    const name = str(o.name) || str(o.id);
    return { context: withNote(`${name} (${org(o.lab)}, released ${str(o.released)})`), title: modelSourceTitle(name, url), titlePri: 60 };
  }
  if (rel === 'benchmarks.yaml') return { context: withNote(`${label(o)} benchmark page`), title: primary ? label(o) : undefined, titlePri: 70, hint: 'leaderboard' };
  if (rel === 'scaling-vectors.yaml') return { context: withNote(`Scaling vector: ${label(o)} (${str(o.date)})`) };
  if (rel === 'breakthroughs.yaml' || rel === 'spending-commitments.yaml') {
    const who = `${str(o.date)} · ${label(o)}${o.company ? ` (${org(o.company)})` : ''}`;
    return { context: withNote(who), title: primary ? label(o) : undefined, titlePri: 55 };
  }
  if (rel === 'capex.yaml') {
    const co = CAPEX_CO[str(o.company)] ?? org(o.company);
    if (area === 'quarters') {
      const fy = str(o.note).match(/FY\d+ Q\d/)?.[0];
      if (field === 'headlineUrl') return { context: `${co} ${str(o.quarter)} · headline capex (earnings call)`, title: `${co} earnings${fy ? ` · ${fy}` : ''}`, titlePri: 60, hint: 'filing' };
      return { context: withNote(`${co} ${str(o.quarter)} · cash capex`), title: primary ? `${co} quarterly filing · ${str(o.quarter)}` : undefined, titlePri: 60, hint: 'filing' };
    }
    if (area === 'guidance') return { context: withNote(`${co} ${str(o.period)} capex guidance (stated ${str(o.stated)})`) };
  }
  if (rel === 'ai2027.yaml') {
    if (isRoot && field === 'source') return { context: 'AI 2027 scenario (source)', title: 'AI 2027', titlePri: 75, hint: 'forecast' };
    if (area === 'pageUrls') return { context: `AI 2027 scenario · ${field} page`, title: `AI 2027 · ${humanKey(field)}`, titlePri: 70, hint: 'forecast' };
    if (area === 'milestones') return { context: withNote(`Milestone: ${label(o)} (${str(o.status)})`) };
    if (area === 'authorsPaceEstimate') return { context: withNote(`Authors' pace estimate ${str(o.published)}: ${str(o.pacePct)}% of AI 2027's pace`) };
  }
  if (rel === 'ai2027-proxies.yaml') return { context: withNote(`Proxy: ${label(o)} (${str(o.status)})`) };
  if (rel === 'ai2027-updates.yaml') {
    return { context: withNote(`${str(o.forecaster)} · ${str(o.milestone)} median ${str(o.median).slice(0, 7)} (stated ${str(o.published)})`) };
  }
  if (rel === 'ai2040.yaml') {
    if (isRoot) {
      const t: Record<string, string> = { source: 'AI 2040', pdf: 'AI 2040 (PDF)', summaryPage: 'AI 2040 · summary' };
      return { context: `AI 2040 scenario · ${FIELD_NOTE[field] || field}`, title: t[field], titlePri: 75, hint: 'forecast' };
    }
    if (area === 'plans') return { context: withNote(`Plan ${str(o.id)}: ${str(o.name)}`), title: primary ? `AI 2040 · Plan ${str(o.id)}: ${str(o.name)} (${str(o.subtitle)})` : undefined, titlePri: 70 };
    if (area === 'stages') return { context: withNote(`${str(o.year)}: ${str(o.title)}`), title: primary ? `AI 2040 · ${str(o.year)}: ${str(o.title)}` : undefined, titlePri: 70 };
    if (area === 'preconditions') {
      const stage = stack.at(-2);
      return { context: withNote(`${stage ? `${str(stage.year)} ` : ''}precondition (${str(o.status)}): ${str(o.text)}`) };
    }
  }
  if (rel === 'lev.yaml') {
    if (area === 'manifold' || (area === 'forecasts' && field === 'url')) return { context: withNote(`${humanKey(area === 'forecasts' ? 'metaculus' : area)}: ${label(o)}`), title: primary ? `${area === 'manifold' ? 'Manifold' : 'Metaculus'}: ${label(o)}` : undefined, titlePri: 70, hint: 'forecast' };
    if (area === 'named') {
      const yr = o.levYear ? `LEV ${str(o.levYear)}` : Array.isArray(o.levYearRange) ? `LEV ${o.levYearRange.map(str).join('–')}` : 'no LEV year';
      return { context: withNote(`Named forecast: ${str(o.who)}, ${str(o.statedOn).slice(0, 4)} (${yr})`), title: primary ? `${str(o.who)} (${str(o.statedOn).slice(0, 4)}): ${clip(str(o.claim), 90)}` : undefined, titlePri: 45 };
    }
    if (area === 'candidates') return { context: withNote(`Curve candidate: ${label(o)}`), title: primary ? label(o) : undefined, titlePri: 50 };
  }
  if (rel === 'data-sources.yaml') {
    return { context: withNote(`Source catalogue: ${str(o.id)} (${str(o.format)}, HTTP ${str(o.status)})`), hint: 'dataset' };
  }

  // Generic: area label + the owning object's label.
  const who = isRoot ? humanKey(field) : `${humanKey(area ?? '')}: ${label(o)}`.replace(/^: /, '');
  return { context: isRoot ? who : withNote(who), title: primary && !isRoot && label(o) && label(o) !== str(o.id) ? label(o) : undefined, titlePri: 50 };
}

const yamlPaths = yamlFiles(CURATED);
let curatedHits = 0;
for (const file of yamlPaths) {
  const rel = path.relative(CURATED, file).split(path.sep).join('/');
  let doc: unknown;
  try {
    doc = readYaml(file);
  } catch (e) {
    warnings.push(`${rel}: YAML parse error — ${(e as Error).message.split('\n')[0]}`);
    continue;
  }
  const root: Obj = isObj(doc) ? doc : { '(root)': doc };
  const visit = (v: unknown, field: string, owner: Obj, trail: string[], stack: Obj[]) => {
    if (typeof v === 'string') {
      const whole = isUrlStr(v);
      const found = whole ? [v.trim()] : urlsIn(v);
      for (const u of found) {
        const w: Where = { rel, doc, owner, field, embedded: !whole, trail, stack };
        const d = describe(w, u);
        add(u, { ...d, section: sectionFor(rel, owner), file: rel, origin: 'curated' });
        curatedHits++;
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) visit(x, field, owner, trail, stack);
      return;
    }
    if (isObj(v)) {
      // Dead endpoints are documented so nobody retries them; they are not sources.
      if (typeof v.status === 'number' && v.status >= 400) {
        const dead = new Set<string>();
        const collect = (y: unknown): void => {
          if (typeof y === 'string') urlsIn(y).forEach((u) => dead.add(u));
          else if (Array.isArray(y)) y.forEach(collect);
          else if (isObj(y)) Object.values(y).forEach(collect);
        };
        collect(v);
        for (const u of dead) skipped.push({ url: u, file: rel, reason: `marked HTTP ${v.status}` });
        return;
      }
      const t = v === root ? trail : [...trail, field];
      for (const [k, x] of Object.entries(v)) visit(x, k, v, t, v === root ? stack : [...stack, v]);
    }
  };
  visit(root, '(root)', root, [], [root]);
}

// ── 3. Epoch per-row source links (scores.json), collapsed per leaderboard ──
const scores = readJson<ScoresData>(path.join(OUT, 'scores.json'));
const scoreRows = { independent: 0, lab: 0, epoch: 0, curated: 0 };
if (!scores) warnings.push('public/data/scores.json missing — run `npm run build:data` first (Epoch row links skipped)');
else {
  for (const r of scores.records) {
    scoreRows[r.prov === 'lab' ? 'lab' : 'independent']++;
    scoreRows[r.src]++;
  }
  const epochRows = scores.records.filter((r) => r.src === 'epoch' && r.url);
  const perHost = new Map<string, Set<string>>();
  for (const r of epochRows) {
    const x = parseUrl(r.url!);
    if (!x) continue;
    const h = hostKey(x);
    (perHost.get(h) ?? perHost.set(h, new Set()).get(h)!).add(urlKey(x));
  }
  const KNOWN: Record<string, string> = {
    'epoch.ai/benchmarks': 'Epoch AI Benchmarking Hub',
    'epoch.ai/eci': 'Epoch Capabilities Index (ECI)',
    'arcprize.org/leaderboard': 'ARC Prize leaderboard',
    'tbench.ai/leaderboard/terminal-bench/2.0': 'Terminal-Bench 2.0 leaderboard',
    'os-world.github.io': 'OSWorld leaderboard',
    'metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks': 'METR: Measuring AI ability to complete long tasks',
  };
  // group key → benchmark → rows
  const groups = new Map<string, { url: string; host: string; collapsed: boolean; urls: Set<string>; byBench: Map<string, { rows: number; models: Set<string> }> }>();
  for (const r of epochRows) {
    const x = parseUrl(r.url!);
    if (!x) continue;
    const h = hostKey(x);
    const collapse = h === 'logs.epoch.ai' || (perHost.get(h)?.size ?? 0) > 5;
    const key = collapse ? `host:${h}` : urlKey(x);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { url: collapse ? `https://${h}/` : r.url!, host: h, collapsed: collapse, urls: new Set(), byBench: new Map() }));
    g.urls.add(urlKey(x));
    const b = g.byBench.get(r.b) ?? g.byBench.set(r.b, { rows: 0, models: new Set() }).get(r.b)!;
    b.rows++;
    b.models.add(r.m);
  }
  for (const [key, g] of groups) {
    const k = urlKey(parseUrl(g.url)!);
    const title = g.collapsed
      ? g.host === 'logs.epoch.ai'
        ? `Epoch AI eval logs (Inspect log viewer, ${g.urls.size.toLocaleString()} runs)`
        : `${g.host} (${g.urls.size} links)`
      : KNOWN[k];
    for (const [b, s] of [...g.byBench].sort((a, c) => c[1].rows - a[1].rows)) {
      add(g.url, {
        key: g.collapsed ? key : undefined,
        section: 'Benchmarks',
        file: 'scores.json',
        context: `Epoch row source · ${benchName.get(b) ?? (b === 'eci' ? 'Epoch Capabilities Index' : b)}: ${s.rows} row${s.rows === 1 ? '' : 's'}, ${s.models.size} model${s.models.size === 1 ? '' : 's'}`,
        n: s.rows,
        origin: 'fetched',
        title,
        titlePri: title && !g.collapsed ? 95 : 85,
        hint: 'leaderboard',
        grouped: g.collapsed ? g.urls.size : undefined,
      });
    }
  }
}

// ── 4. Evidence links inside Alan's fetched data (alan.json) ───────────────
const GENERIC_LINK = /^(link|source|here|\d+|announce|article|video|paper|pdf|archive|wiki|repo|report|analysis)$/i;
const alan = readJson<AlanData>(path.join(OUT, 'alan.json'));
if (!alan) warnings.push('public/data/alan.json missing — Countdown evidence links skipped');
else {
  const A = { section: 'Countdown' as const, file: 'alan.json', origin: 'fetched' as const };
  // Log titles can still carry the gauge prefix ("48%: …", "INFO/Correction: …") when the entry had no <strong> title.
  const tidy = (t: string) => t.replace(/^\s*(\d{1,3}%|INFO(\/[A-Za-z]+)?)\s*:\s*/i, '');
  const withLabel = (t: string, l: string) => (l && l.toLowerCase() !== 'link' ? `${clip(tidy(t), 110)} (${l})` : clip(tidy(t), 120));
  for (const l of alan.agi.log) {
    for (const k of l.links) {
      const lab = GENERIC_LINK.test(k.label) ? '' : ` · ${k.label}`;
      const gauge = l.kind === 'pct' && l.value !== undefined ? `gauge ${l.value}% · ` : '';
      add(k.url, { ...A, context: `AGI log · ${monthYear(l.date)} · ${gauge}${tidy(l.title) || clip(tidy(l.summary), 90)}${lab}`, title: withLabel(l.title || l.summary, k.label), titlePri: 40 });
    }
  }
  for (const i of alan.asi.items) {
    const ctx = `ASI checklist #${i.id}: ${i.label} (${i.status})`;
    for (const u of i.links) add(u, { ...A, context: ctx, title: `ASI #${i.id}: ${i.label}`, titlePri: 35 });
    for (const u of urlsIn(i.notes ?? '')) add(u, { ...A, context: `${ctx} · cited in notes`, title: `ASI #${i.id}: ${i.label}`, titlePri: 30 });
  }
  for (const l of alan.asi.log) {
    const ids = l.ids.map((x) => `#${x.id}`).join(' ');
    for (const k of l.links) add(k.url, { ...A, context: `ASI evidence · ${monthYear(l.date)} · ${ids} · ${l.title}`, title: withLabel(l.title, k.label), titlePri: 40 });
  }
  for (const d of alan.asi.discoveries) {
    if (d.url) add(d.url, { ...A, context: `AI discoveries #${d.n} · ${d.org} · ${d.model}`, title: `${d.discovery} (${d.org})`, titlePri: 45, hint: 'lab' });
  }
}

// ── 5. Finalise ────────────────────────────────────────────────────────────
const out: Ref[] = [...refs.values()].map((a) => {
  const x = parseUrl(a.url)!;
  const hint = [...a.hints].sort((p, q) => q[1] - p[1])[0]?.[0];
  const usedIn = [...a.usages.values()].sort((p, q) => SECTIONS.indexOf(p.section) - SECTIONS.indexOf(q.section) || (q.n ?? 1) - (p.n ?? 1));
  const r: Ref = {
    url: a.url,
    host: hostKey(x),
    title: a.title || fallbackTitle(x),
    kind: a.kind ?? classify(x, hint),
    usedIn,
    count: a.count,
    origins: [...a.origins].sort(),
  };
  if (a.grouped) r.grouped = a.grouped;
  return r;
});
out.sort((p, q) => q.count - p.count || p.title.localeCompare(q.title));

// Citations: attribution text for each upstream whose data is republished here.
const yamlMeta = (f: string) => readYaml<Obj>(cur(f)) ?? {};
const a27 = yamlMeta('ai2027.yaml');
const a40 = yamlMeta('ai2040.yaml');
const authors = (o: Obj) => (Array.isArray(o.authors) ? o.authors.map(str).join(', ') : 'AI Futures Project');
const yearOf = (o: Obj) => str(o.published).slice(0, 4);
const day = (iso?: string) => (iso ? iso.slice(0, 10) : 'n.d.');
const fetchedOn = (id: string) => day(feeds.find((f) => f.id === id)?.lastFetched);
const citations: Citation[] = [
  {
    id: 'epoch',
    source: 'Epoch AI',
    text: `Epoch AI, "Capabilities & Benchmarking" (AI Benchmarking Hub and Epoch Capabilities Index). Published online at epoch.ai. Retrieved ${fetchedOn('epoch')} from https://epoch.ai/benchmarks. Licensed CC BY 4.0.`,
    url: 'https://epoch.ai/benchmarks',
    license: 'CC BY 4.0',
  },
  {
    id: 'inference-cost',
    source: 'Epoch AI · inference cost',
    text: `Roodman, D. / Epoch AI (2026), "The Plunging Price of Thought". https://epoch.ai/publications/the-plunging-price-of-thought. Data: https://github.com/droodman/inference-cost (retrieved ${fetchedOn('inference-cost')}).`,
    url: 'https://epoch.ai/publications/the-plunging-price-of-thought',
    license: 'Cite the report',
  },
  {
    id: 'alan',
    source: 'Dr Alan D. Thompson',
    text: `Thompson, A. D. (2026). AGI countdown and ASI checklist. LifeArchitect.ai. https://lifearchitect.ai/agi/ and https://lifearchitect.ai/asi/ (retrieved ${fetchedOn('alan')}).`,
    url: 'https://lifearchitect.ai/agi/',
    license: 'Free to use with citation',
  },
  {
    id: 'owid',
    source: 'Our World in Data',
    text: `Our World in Data (2026). "Maximum life expectancy (female)" and "Remaining life expectancy at different ages", processed from HMD, UN WPP, Riley (2005) and Zijdeman et al. (2015). https://ourworldindata.org/life-expectancy (retrieved ${fetchedOn('owid')}). Licensed CC BY 4.0.`,
    url: 'https://ourworldindata.org/life-expectancy',
    license: 'CC BY 4.0',
  },
  {
    id: 'ai2027',
    source: 'AI Futures Project · AI 2027',
    text: `${authors(a27)} (${yearOf(a27) || '2025'}). AI 2027. AI Futures Project. ${str(a27.source) || 'https://ai-2027.com'}`,
    url: str(a27.source) || 'https://ai-2027.com',
    license: 'Cite the scenario',
  },
  {
    id: 'ai2040',
    source: 'AI Futures Project · AI 2040',
    text: `${authors(a40)} (${yearOf(a40) || '2026'}). AI 2040. AI Futures Project. ${str(a40.source) || 'https://ai-2040.com'}`,
    url: str(a40.source) || 'https://ai-2040.com',
    license: 'Cite the scenario',
  },
];

// Stats
const byKind = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
const bySection = Object.fromEntries(SECTIONS.map((s) => [s, 0])) as Record<Section, number>;
const byOrigin = { fetched: 0, curated: 0, both: 0 };
const hostAgg = new Map<string, { refs: number; count: number }>();
const fileAgg = new Map<string, number>();
for (const r of out) {
  byKind[r.kind]++;
  for (const s of new Set(r.usedIn.map((u) => u.section))) bySection[s]++;
  for (const f of new Set(r.usedIn.map((u) => u.file))) fileAgg.set(f, (fileAgg.get(f) ?? 0) + 1);
  if (r.origins.length > 1) byOrigin.both++;
  else byOrigin[r.origins[0]]++;
  const h = hostAgg.get(r.host) ?? hostAgg.set(r.host, { refs: 0, count: 0 }).get(r.host)!;
  h.refs++;
  h.count += r.count;
}
const data: RefsData = {
  generatedAt: new Date().toISOString(),
  feeds,
  citations,
  refs: out,
  stats: {
    total: out.length,
    hosts: hostAgg.size,
    citations: out.reduce((s, r) => s + r.count, 0),
    byKind,
    bySection,
    byOrigin,
    byHost: [...hostAgg].map(([host, v]) => ({ host, ...v })).sort((p, q) => q.refs - p.refs || q.count - p.count).slice(0, 30),
    files: [...fileAgg].map(([file, n]) => ({ file, refs: n })).sort((p, q) => q.refs - p.refs),
    scoreRows,
    skipped: skipped.length,
  },
};
const outFile = path.join(OUT, 'references.json');
writeJson(outFile, data);

const kb = (statSync(outFile).size / 1024).toFixed(0);
const fmt = (o: Record<string, number>) => Object.entries(o).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ');
console.log(`references ${out.length} unique URLs · ${hostAgg.size} hosts · ${data.stats.citations.toLocaleString()} citations (${curatedHits} curated YAML hits) · ${kb} KB`);
console.log(`  by kind:    ${fmt(byKind)}`);
console.log(`  by section: ${fmt(bySection)}`);
console.log(`  by origin:  curated ${byOrigin.curated} · fetched ${byOrigin.fetched} · both ${byOrigin.both}`);
console.log(`  top hosts:  ${data.stats.byHost.slice(0, 10).map((h) => `${h.host} ${h.refs}`).join(' · ')}`);
console.log(`  feeds ${feeds.length} (${feeds.reduce((s, f) => s + f.endpoints.length, 0)} endpoints) · skipped ${skipped.length} (${[...new Set(skipped.map((s) => s.reason))].join(', ') || 'none'})`);
for (const w of warnings) console.warn(`  ! ${w}`);
