import { motion } from 'motion/react';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useAlan, useCore, useScores, useTrends } from '../lib/data.ts';
import { fmtMinutes, monthYear, shortDate } from '../lib/format.ts';
import { setTheme, useTheme } from '../lib/tokens.ts';
import { setTab, TABS, useTab } from '../lib/ui-state.ts';

function Logo() {
  return (
    <svg viewBox="0 0 40 40" className="h-9 w-9 shrink-0" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="var(--glow-a)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="15" fill="none" stroke="var(--line-2)" strokeWidth="1" />
      <circle cx="20" cy="20" r="15" fill="none" stroke="url(#lg)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="85 100" transform="rotate(-90 20 20)">
        <animateTransform attributeName="transform" type="rotate" from="-90 20 20" to="270 20 20" dur="18s" repeatCount="indefinite" />
      </circle>
      <ellipse cx="20" cy="20" rx="15" ry="5" fill="none" stroke="var(--glow-b)" strokeOpacity=".5" strokeWidth="1" transform="rotate(-25 20 20)" />
      <circle cx="20" cy="20" r="3.2" fill="var(--accent)" />
    </svg>
  );
}

export function Header() {
  const tab = useTab();
  const theme = useTheme();
  const ref = useRef<HTMLElement>(null);

  // Publish the sticky header's height as --hdr so full-height views (e.g. the benchmark table) can fill the rest.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--hdr', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) return;
      const t = TABS.find((x) => x.key === e.key);
      if (t) setTab(t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header ref={ref} className="sticky top-0 z-30 border-b border-line bg-[color-mix(in_oklab,var(--bg)_72%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1520px] items-center gap-4 px-4 py-3 sm:px-6">
        <a href="#alan" onClick={(e) => (e.preventDefault(), setTab('alan'))} className="flex items-center gap-2.5">
          <Logo />
          <div className="leading-tight">
            <div className="whitespace-nowrap font-mono text-[13px] font-semibold tracking-[0.22em]">FRONTIER WATCH</div>
            <div className="hidden text-[11px] text-ink-3 sm:block">Abhinav's AGI observatory</div>
          </div>
        </a>

        <nav aria-label="Sections" className="mx-auto hidden items-center gap-1 rounded-full border border-line bg-surface/60 p-1 md:flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`relative whitespace-nowrap rounded-full px-4 py-1.5 text-left transition-colors ${tab === t.id ? 'text-accent-ink' : 'text-ink-2 hover:text-ink'}`}
            >
              {tab === t.id && <motion.span layoutId="tab-thumb" className="absolute inset-0 rounded-full bg-accent shadow-[0_0_24px_-4px_var(--accent)]" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
              <span className="relative flex items-baseline gap-2">
                <span className="text-[13px] font-semibold">{t.label}</span>
                <span className={`hidden font-mono text-[10px] xl:inline ${tab === t.id ? 'opacity-70' : 'text-ink-3'}`}>{t.sub}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <button
            onClick={() => setTab('references')}
            aria-current={tab === 'references' ? 'page' : undefined}
            aria-label="Sources and references"
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 font-mono text-[11px] ${tab === 'references' ? 'border-[var(--accent)] text-ink' : 'border-line bg-surface/60 text-ink-2 hover:text-ink'}`}
          >
            ⌘<span className="hidden sm:inline"> sources</span>
          </button>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="whitespace-nowrap rounded-full border border-line bg-surface/60 px-3 py-1.5 font-mono text-[11px] text-ink-2 hover:text-ink"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? '☾' : '☀'}
            <span className="hidden sm:inline">{theme === 'dark' ? ' dark' : ' light'}</span>
          </button>
        </div>
      </div>

      {/* Mobile tabs */}
      <nav aria-label="Sections" className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`shrink-0 rounded-full px-3 py-1 text-[12.5px] font-semibold ${tab === t.id ? 'bg-accent text-accent-ink' : 'border border-line text-ink-2'}`}>
            {t.label}
          </button>
        ))}
      </nav>

      <Suspense fallback={<div className="h-8 border-t border-line" />}>
        <Ticker />
      </Suspense>
    </header>
  );
}

/** Live marquee of headline numbers, all derived from the data bundles. */
function Ticker() {
  const core = useCore();
  const { records } = useScores();
  const trends = useTrends();
  const alan = useAlan();
  const items = useMemo(() => {
    const byId = new Map(core.models.map((m) => [m.id, m]));
    const out: { k: string; v: string; s?: string }[] = [];
    out.push({ k: 'AGI countdown', v: `${alan.agi.value}%`, s: `Alan D. Thompson · ${monthYear(alan.agi.lastUpdate)}` });
    const ach = alan.asi.items.filter((i) => i.status === 'achieved').length;
    const par = alan.asi.items.filter((i) => i.status === 'partial').length;
    out.push({ k: 'ASI checklist', v: `${ach}/50 achieved`, s: `${par} partial` });
    const topEci = [...trends.eci].sort((a, b) => b.eci - a.eci)[0];
    if (topEci) out.push({ k: 'Frontier ECI', v: topEci.eci.toFixed(1), s: topEci.name });
    const topMetr = [...trends.metr].sort((a, b) => b.p50 - a.p50)[0];
    if (topMetr) out.push({ k: 'METR 50% horizon', v: fmtMinutes(topMetr.p50), s: topMetr.name });
    const best = (b: string, indep: boolean) => records.filter((r) => r.b === b && (!indep || r.prov === 'independent')).sort((x, y) => y.v - x.v)[0];
    for (const [b, label, indep] of [
      ['hle', 'HLE · independent', true],
      ['frontiermath-t4-v2', 'FrontierMath T4 · Epoch', true],
      ['arc-agi-2', 'ARC-AGI-2', true],
      ['swe-bench-pro-public', 'SWE-bench Pro', false],
    ] as const) {
      const r = best(b, indep);
      if (r) out.push({ k: label, v: `${r.v.toFixed(1)}%`, s: byId.get(r.m)?.name });
    }
    const latest = [...core.models].filter((m) => m.status !== 'announced').sort((a, b) => b.released.localeCompare(a.released))[0];
    if (latest) {
      const days = Math.max(0, Math.round((Date.now() - Date.parse(latest.released)) / 864e5));
      out.push({ k: 'Latest frontier release', v: latest.name, s: `${shortDate(latest.released)} · ${days}d ago` });
    }
    return out;
  }, [core, records, trends, alan]);

  const row = (
    <div className="flex shrink-0 items-center">
      {items.map((i) => (
        <span key={i.k} className="flex items-center gap-2 whitespace-nowrap px-5 text-[11.5px]">
          <span className="kicker !text-[10px]">{i.k}</span>
          <span className="font-mono font-semibold text-ink">{i.v}</span>
          {i.s && <span className="text-ink-3">{i.s}</span>}
          <span className="pl-3 text-ink-3/50">/</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className="relative flex h-8 items-center overflow-hidden border-t border-line" aria-label="Headline numbers">
      <div className="marquee flex w-max">
        {row}
        {row}
      </div>
    </div>
  );
}
