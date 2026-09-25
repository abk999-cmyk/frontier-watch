/**
 * URL helpers shared by scripts/build-references.ts and the References tab:
 * normalisation (dedupe key), host, a heuristic kind classifier and a readable fallback title.
 */
import type { Kind } from './types.ts';

/** Every http(s) URL inside a string, with trailing prose punctuation removed. */
export function urlsIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/https?:\/\/[^\s"'<>\]]+/g)) {
    let u = m[0];
    // Drop trailing punctuation, and a closing paren only when it is unbalanced ("(see https://x.com/a)").
    for (;;) {
      if (/[.,;:!?'"]$/.test(u)) u = u.slice(0, -1);
      else if (u.endsWith(')') && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1);
      else break;
    }
    out.push(u);
  }
  return out;
}

export function parseUrl(u: string): URL | null {
  try {
    const x = new URL(u.trim());
    return x.protocol === 'http:' || x.protocol === 'https:' ? x : null;
  } catch {
    return null;
  }
}

/** Hostname without `www.` and without a trailing dot. */
export const hostKey = (x: URL) => x.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

/** Dedupe key: scheme-, www- and trailing-slash-insensitive; keeps query and fragment (they address different things). */
export function urlKey(x: URL): string {
  const p = x.pathname.replace(/\/+$/, '') || '';
  return `${hostKey(x)}${p}${x.search}${x.hash}`;
}

/** Canonical display URL: https, no trailing dot on the host. */
export function canonical(x: URL): string {
  const y = new URL(x.href);
  if (y.protocol === 'http:' && !/^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(y.hostname)) y.protocol = 'https:';
  y.hostname = y.hostname.replace(/\.$/, '');
  return y.href;
}

const has = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

const LAB = [
  'openai.com', 'chatgpt.com', 'anthropic.com', 'claude.com', 'claude.ai', 'deepmind.google', 'deepmind.com', 'blog.google', 'ai.google', 'ai.google.dev',
  'research.google', 'ai.googleblog.com', 'developers.googleblog.com', 'x.ai', 'grok.com', 'deepseek.com', 'qwenlm.github.io', 'qwen.ai', 'alibabacloud.com',
  'kimi.com', 'moonshot.ai', 'moonshot.cn', 'moonshotai.github.io', 'z.ai', 'zhipuai.cn', 'bigmodel.cn', 'minimax.io', 'minimaxi.com', 'mistral.ai', 'ai.meta.com',
  'research.meta.ai', 'about.fb.com', 'llama.com', 'microsoft.com', 'blogs.microsoft.com', 'nvidia.com', 'nvidianews.nvidia.com', 'aboutamazon.com',
  'aws.amazon.com', 'sakana.ai', 'futurehouse.org', 'cursor.com', 'cognition.ai', 'figure.ai', '1x.tech', 'bostondynamics.com', 'agilityrobotics.com',
  'apptronik.com', 'generalistai.com', 'sesame.com', 'pi.website', 'genesis.ai', 'robotera.com', 'math.inc', 'weco.ai', 'osmo.ai', 'scentience.ai', 'sabi.io',
  'harmonic.fun', 'isomorphiclabs.com', 'reflection.ai', 'thinkingmachines.ai', 'ssi.inc', 'ai21.com', 'cohere.com', 'nousresearch.com',
];
const PAPER = [
  'arxiv.org', 'nature.com', 'science.org', 'doi.org', 'journals.aps.org', 'journals.plos.org', 'papers.ssrn.com', 'ssrn.com', 'biorxiv.org', 'medrxiv.org',
  'pubs.acs.org', 'cell.com', 'pnas.org', 'proceedings.mlr.press', 'nejm.org', 'openreview.net', 'aclanthology.org', 'semanticscholar.org', 'sciencedirect.com',
  'springer.com', 'link.springer.com', 'thelancet.com', 'jmlr.org', 'neurips.cc', 'papers.nips.cc', 'ieeexplore.ieee.org', 'dl.acm.org', 'researchgate.net',
  'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'plos.org', 'frontiersin.org', 'mdpi.com', 'wiley.com', 'tandfonline.com', 'academic.oup.com',
];
const LEADERBOARD = [
  'tbench.ai', 'arcprize.org', 'swebench.com', 'matharena.ai', 'lastexam.ai', 'agi.safe.ai', 'deepswe.datacurve.ai', 'frontierswe.com', 'os-world.github.io',
  'critpt.com', 'scicode-bench.github.io', 'virologytest.ai', 'wmdp.ai', 'taubench.com', 'simple-bench.com', 'artificialanalysis.ai', 'lmarena.ai', 'livebench.ai',
  'vals.ai', 'toolathlon.xyz', 'benchlm.ai', 'andonlabs.com', 'drivingbench.com', 'metr.org', 'gpqa.org', 'aider.chat', 'livecodebench.github.io',
  'mmmu-benchmark.github.io', 'epoch.ai/benchmarks',
];
const FORECAST = ['metaculus.com', 'manifold.markets', 'polymarket.com', 'kalshi.com', 'goodjudgment.com', 'ai-2027.com', 'ai-2040.com', 'aifuturesmodel.com', 'ai2027-tracker.com'];
const WIKI = ['wikipedia.org', 'wikimedia.org', 'wikidata.org'];
const FILING = ['sec.gov', 'edgar.sec.gov', 'ir.amd.com'];
const DATASET = ['raw.githubusercontent.com', 'github.com', 'gist.github.com', 'catalog.ourworldindata.org', 'ourworldindata.org', 'logs.epoch.ai', 'kaggle.com', 'colab.research.google.com', 'drive.google.com', 'data.x.ai', 'zenodo.org', 'figshare.com'];
const NEWS = [
  'cnbc.com', 'techcrunch.com', 'fortune.com', 'technologyreview.com', 'reuters.com', 'theguardian.com', 'scmp.com', 'bloomberg.com', 'venturebeat.com',
  'prnewswire.com', 'thenextweb.com', 'the-decoder.com', 'tomshardware.com', 'axios.com', 'news.gallup.com', 'wsj.com', 'nytimes.com', 'forbes.com',
  'economist.com', 'inc.com', 'popularmechanics.com', 'news.harvard.edu', 'news.mit.edu', 'techxplore.com', 'datacenterdynamics.com', 'nextbigfuture.com',
  'piunikaweb.com', 'interestingengineering.com', 'kr-asia.com', 'news.futunn.com', 'e.vnexpress.net', 'newatlas.com', 'noemamag.com', 'theconversation.com',
  'pcmag.com', 'koreaherald.com', 'globaltimes.cn', 'gadgetreview.com', 'electrek.co', 'biz.chosun.com', 'en.prnasia.com', 'startupfortune.com',
  'koreatimes.co.kr', 'humanoidsdaily.com', 'policinginsight.com', 'gulfnews.com', 'abc.net.au', 'politico.eu', 'politico.com', 'finance.yahoo.com',
  'investing.com', 'semafor.com', 'theinformation.com', 'ft.com', 'wired.com', 'arstechnica.com', 'theverge.com', 'businessinsider.com', 'cnn.com', 'bbc.com',
  'bbc.co.uk', 'apnews.com', 'washingtonpost.com', 'zdnet.com', 'engadget.com', 'siliconangle.com', 'theregister.com', 'metal.com', 'businesswire.com',
  'globenewswire.com', 'nikkei.com', 'asia.nikkei.com', 'caixinglobal.com', 'scientificamerican.com', 'newscientist.com', 'quantamagazine.org', 'vox.com',
  'time.com', 'nbcnews.com', 'cbsnews.com', 'theatlantic.com', 'newyorker.com', 'marketwatch.com', 'barrons.com', 'seekingalpha.com', 'yicaiglobal.com',
];
const BLOG = [
  'substack.com', 'blog.aifutures.org', 'lifearchitect.ai', 'wordpress.com', 'lesswrong.com', 'alignmentforum.org', 'astralcodexten.com', 'darioamodei.com',
  'dwarkesh.com', 'newsletter.semianalysis.com', 'semianalysis.com', 'every.to', 'blog.samaltman.com', 'scottaaronson.blog', 'thelongcontext.com', 'medium.com',
  'x.com', 'twitter.com', 'twitter-thread.com', 'threads.net', 'bsky.app', 'linkedin.com', 'reddit.com', 'mathstodon.xyz', 'mp.weixin.qq.com', 'zhuanlan.zhihu.com',
  'community.wolfram.com', 'blog.adafruit.com', 'cryptocellar.org', 'gwern.net', 'simonwillison.net', 'interconnects.ai', 'oneusefulthing.org',
];
const DATA_EXT = /\.(csv|tsv|zip|json|jsonl|parquet|feather|ya?ml|xlsx?|gz)$/i;
const CARD_PATH = /(system[-_ ]?card|model[-_ ]?card|modelcard|safety[-_ ]?report|tech(nical)?[-_ ]?report)/i;

/** Heuristic classification from host + path. `hint` wins only when the URL itself says nothing specific. */
export function classify(u: string | URL, hint?: Kind): Kind {
  const x = typeof u === 'string' ? parseUrl(u) : u;
  if (!x) return hint ?? 'other';
  const host = hostKey(x);
  const p = decodeURIComponent(x.pathname).toLowerCase();
  const hp = `${host}${p}`;

  if (host === 'epoch.ai') {
    if (/^\/(benchmarks|eci)(\/|$)/.test(p) || /^\/frontiermath\/?$/.test(p)) return 'leaderboard';
    if (/^\/data\//.test(p) || DATA_EXT.test(p)) return 'dataset';
    if (/^\/(publications|papers)\//.test(p)) return 'paper';
    return 'blog';
  }
  if (host === 'docs.google.com' && /\/spreadsheets\//.test(p)) return 'dataset';
  if (host === 'storage.googleapis.com') return /deepmind/.test(p) ? 'lab' : 'dataset';
  if (host === 'scale.com') return /leaderboard/.test(p) ? 'leaderboard' : 'lab';
  if (host === 'huggingface.co') return /^\/(datasets|spaces)\//.test(p) ? 'dataset' : 'lab';
  if (/^(api|api2)\./.test(host) || /^\/api\d?\//.test(p)) return 'dataset';
  if (has(host, FILING) || /^(ir|investor|investors)\./.test(host) || /\/investor(s|-relations)?\//.test(p)) return 'filing';
  if (has(host, FORECAST)) return 'forecast';
  if (has(host, WIKI)) return 'wiki';
  if (has(host, PAPER)) return 'paper';
  if (LEADERBOARD.some((d) => hp === d || hp.startsWith(`${d}/`) || host === d || host.endsWith(`.${d}`))) return 'leaderboard';
  if (has(host, LAB)) return 'lab';
  if (DATA_EXT.test(p)) return 'dataset';
  if (has(host, DATASET)) return 'dataset';
  if (has(host, NEWS) || /^news\./.test(host)) return 'news';
  if (has(host, BLOG) || /^blog\./.test(host)) return 'blog';
  if (host.endsWith('.github.io') || /\.edu$|\.ac\.uk$|\.ac\.[a-z]{2}$/.test(host)) return 'paper';
  if (/\/leaderboard/.test(p)) return 'leaderboard';
  if (CARD_PATH.test(p)) return 'lab';
  return hint ?? 'other';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const EXT_LABEL: Record<string, string> = { csv: 'CSV', zip: 'ZIP', json: 'JSON', yaml: 'YAML', yml: 'YAML', parquet: 'Parquet', pdf: 'PDF', xlsx: 'Excel' };

/** Readable title from the URL alone, used when no curated label exists. */
export function fallbackTitle(u: string | URL): string {
  const x = typeof u === 'string' ? parseUrl(u) : u;
  if (!x) return String(u);
  const host = hostKey(x);
  const segs = x.pathname.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  if (host === 'arxiv.org') {
    const id = x.pathname.match(/(\d{4}\.\d{4,5})(v\d+)?/);
    if (id) return `arXiv:${id[1]}`;
  }
  if (host === 'doi.org' && segs.length) return `DOI ${segs.join('/')}`;
  if (host === 'sec.gov') {
    const acc = x.pathname.match(/(\d{10}-\d{2}-\d{6})/) ?? x.pathname.match(/\/(\d{18})\//);
    const cik = x.pathname.match(/\/data\/(\d+)\//);
    return `SEC EDGAR filing${cik ? ` · CIK ${cik[1]}` : ''}${acc ? ` · ${acc[1]}` : ''}`;
  }
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'YouTube video';
  if ((host === 'x.com' || host === 'twitter.com') && segs.length) return segs[1] === 'status' ? `Post by @${segs[0]} on X` : `@${segs[0]} on X`;
  if (host === 'github.com' && segs.length >= 2) return `GitHub · ${segs[0]}/${segs[1]}`;
  if (host === 'raw.githubusercontent.com' && segs.length >= 2) return `${segs.at(-1)!.replace(/\.[a-z]+$/i, '')} · ${segs[0]}/${segs[1]}`;
  if (host === 'huggingface.co' && segs.length >= 2) return `Hugging Face · ${segs.slice(0, segs[0] === 'datasets' ? 3 : 2).join('/')}`;
  if (host.endsWith('wikipedia.org') && segs[0] === 'wiki' && segs[1]) return `Wikipedia · ${segs[1].replace(/_/g, ' ')}`;
  if (host === 'docs.google.com' && segs[0] === 'spreadsheets') return 'Google Sheet';
  if (host === 'manifold.markets' && segs.length >= 2) return `Manifold · ${cap(segs[1].replace(/-/g, ' '))}…`;
  if (host === 'ai2027-tracker.com' && segs[0] === 'predictions' && segs[1]) return `AI 2027 tracker · ${cap(segs[1].replace(/-/g, ' '))}`;

  // Walk back from the last segment to the first "wordy" one (skip ids, hashes, index pages).
  const site = SITE[host];
  for (let i = segs.length - 1; i >= 0; i--) {
    const raw = segs[i];
    const ext = raw.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    const base = raw.replace(/\.(html?|php|aspx?|pdf|csv|zip|json|ya?ml|parquet|xlsx?)$/i, '');
    if (/^(index|default|en-us|en|abs|pdf|html|p|post|posts|blog|news|article|articles|a)$/i.test(base)) continue;
    const words = base.split(/[-_+\s]+/).filter(Boolean);
    const wordy = words.filter((w) => /^[a-z][a-z'’]*$/i.test(w)).length;
    if (wordy >= 2 || (wordy === 1 && words.length === 1 && base.length > 3)) {
      const e = ext && EXT_LABEL[ext] ? ` (${EXT_LABEL[ext]})` : '';
      // A lone word ("Bills", "Leaderboard") says little on its own: keep the site and the rest of the path.
      if (wordy === 1) return `${site ?? host} · ${words.length && segs.length - i > 1 ? segs.slice(i).join(' ').replace(/[-_]+/g, ' ') : cap(prettyWords(words))}`.slice(0, 110);
      // "…/benchmark_data.zip#epoch_capabilities_index/eci_scores.csv" addresses one file inside the archive.
      const inner = x.hash.match(/([\w.-]+\.(csv|json|ya?ml|parquet))$/i)?.[1];
      const t = `${cap(prettyWords(words)).slice(0, 110)}${e}${inner ? ` · ${inner}` : ''}`;
      return site ? `${site} · ${t}` : t;
    }
  }
  return (site ?? host) + (segs.length ? ` · ${segs.slice(0, 2).join('/')}` : '');
}

/** Site names used to prefix slug-derived titles ("Epoch AI · AI chip sales"). */
const SITE: Record<string, string> = {
  'epoch.ai': 'Epoch AI',
  'ourworldindata.org': 'Our World in Data',
  'lifearchitect.ai': 'LifeArchitect.ai',
  'metr.org': 'METR',
  'openai.com': 'OpenAI',
  'anthropic.com': 'Anthropic',
  'deepmind.google': 'Google DeepMind',
  'blog.google': 'Google',
  'x.ai': 'xAI',
  'ai-2027.com': 'AI 2027',
  'ai-2040.com': 'AI 2040',
  'blog.aifutures.org': 'AI Futures Project',
  'newsletter.semianalysis.com': 'SemiAnalysis',
  'cnbc.com': 'CNBC',
  'reuters.com': 'Reuters',
  'techcrunch.com': 'TechCrunch',
  'fortune.com': 'Fortune',
  'bloomberg.com': 'Bloomberg',
  'levf.org': 'LEV Foundation',
  'lesswrong.com': 'LessWrong',
  'govtrack.us': 'GovTrack',
  'nist.gov': 'NIST',
  'figure.ai': 'Figure',
};

const ACRONYM: Record<string, string> = {
  ai: 'AI', agi: 'AGI', asi: 'ASI', gpt: 'GPT', llm: 'LLM', llms: 'LLMs', api: 'API', eci: 'ECI', rl: 'RL', ml: 'ML', gpu: 'GPU', gpus: 'GPUs',
  tpu: 'TPU', tpus: 'TPUs', us: 'US', uk: 'UK', eu: 'EU', un: 'UN', ceo: 'CEO', ipo: 'IPO', hle: 'HLE', swe: 'SWE', imo: 'IMO', aime: 'AIME',
  gpqa: 'GPQA', metr: 'METR', owid: 'OWID', hmd: 'HMD', lev: 'LEV', rlhf: 'RLHF', sota: 'SOTA', nlp: 'NLP', hbm: 'HBM', cot: 'CoT', ui: 'UI',
  openai: 'OpenAI', deepmind: 'DeepMind', xai: 'xAI', arc: 'ARC', agents: 'agents', usa: 'USA', nvidia: 'Nvidia',
};
const prettyWords = (words: string[]) => words.map((w) => ACRONYM[w.toLowerCase()] ?? w).join(' ');

/** Two-letter monogram for a host: "openai.com" → "OP", "ai-2027.com" → "A2", "sec.gov" → "SE". */
export function monogram(host: string): string {
  const parts = host.split('.');
  // Registrable label: skip generic second-levels like co.uk / com.au.
  let i = parts.length - 2;
  if (i > 0 && /^(co|com|ac|gov|org|net)$/.test(parts[i]) && parts[i + 1].length === 2) i--;
  const label = parts[Math.max(0, i)] ?? host;
  const bits = label.split('-').filter(Boolean);
  const m = bits.length >= 2 ? bits[0][0] + bits[1][0] : label.slice(0, 2);
  return m.toUpperCase();
}
