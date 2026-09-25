import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { MultiSelect, RangeFilter, SearchInput, type Option } from '../../components/filters/Filters.tsx';
import { Chip } from '../../components/ui/Chip.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Segmented } from '../../components/ui/Segmented.tsx';
import { InfoTip } from '../../components/ui/misc.tsx';
import { countBy, inRange, textMatch } from '../../lib/filters.ts';
import { fmtUsd, monthYear } from '../../lib/format.ts';
import { compact, multiPill, rangePill, textPill } from '../charts/filterModel.ts';
import { ai2040Active, AI2040_EMPTY, filterAi2040, FORK_YEAR, stagedPlanId, type Ai2040Filter, type Ai2040View, type StageMatch } from './filters.ts';
import type { Ai2040, Metric, Plan, PreconditionStatus, Stage } from './types.ts';
import { Code, EmptyState, ExtLink, FilterRow, Hl, hostOf, NoMatches, PRE_STATUS } from './ui.tsx';

const PRE_ORDER: PreconditionStatus[] = ['happened', 'partial', 'not-yet', 'unknown'];

export function Ai2040Panel({ data }: { data: Ai2040 | null }) {
  return (
    <Panel
      kicker={
        <span className="inline-flex items-center gap-1.5">
          AI 2040 · Plan A
          <InfoTip align="left">
            AI 2040 is a policy proposal: a path its authors argue for, not a forecast of what will happen. So there is no lag score here. Each stage lists the preconditions it needs, marked happened / partial / not yet
            against today’s evidence.
          </InfoTip>
        </span>
      }
      title="A proposed path to 2040, and which of its preconditions exist today"
      actions={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line-2 px-2.5 py-1 font-mono text-[10.5px] tracking-[0.12em] text-ink-2">
          <span aria-hidden>⚑</span> PROPOSED PATH · NOT A PREDICTION
        </span>
      }
      footer={
        data?.source ? (
          <span>
            Source: <ExtLink href={data.source}>{hostOf(data.source)}</ExtLink>
            {data.published ? ` (${monthYear(data.published)})` : ''} · preconditions graded{data.statusAsOf ? ` as of ${monthYear(data.statusAsOf)}` : ''} in <Code>data/curated/ai2040.yaml</Code>
          </span>
        ) : undefined
      }
    >
      {!data ? (
        <EmptyState title="No AI 2040 data">
          Curated file missing: <Code>data/curated/ai2040.yaml</Code>. Add it and run <Code>npm run build:data</Code>.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-8">
            {data.stages.length === 0 ? (
              <EmptyState title="No stages yet">
                <Code>ai2040.yaml</Code> has no <Code>stages</Code>.
              </EmptyState>
            ) : (
              <FilteredPath data={data} />
            )}
          </div>
          <aside className="min-w-0 space-y-5 lg:col-span-4">
            {data.framing && (
              <div>
                <div className="kicker mb-1.5">Framing</div>
                <p className="text-[13px] leading-relaxed text-ink-2">{data.framing}</p>
              </div>
            )}
            <Tally stages={data.stages} />
            {data.metrics.length > 0 && <MetricCards metrics={data.metrics} />}
          </aside>
        </div>
      )}
    </Panel>
  );
}

function stageScore(s: Stage) {
  const n = s.preconditions.length;
  const happened = s.preconditions.filter((p) => p.status === 'happened').length;
  const partial = s.preconditions.filter((p) => p.status === 'partial').length;
  return { n, happened, partial, share: n ? (happened + partial * 0.5) / n : 0 };
}

function Tally({ stages }: { stages: Stage[] }) {
  const all = stages.flatMap((s) => s.preconditions);
  if (!all.length) return null;
  const c = { happened: 0, partial: 0, 'not-yet': 0, unknown: 0 };
  for (const p of all) c[p.status]++;
  return (
    <div>
      <div className="kicker mb-2">All preconditions</div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {(['happened', 'partial', 'not-yet', 'unknown'] as const)
          .filter((k) => k !== 'unknown' || c.unknown > 0)
          .map((k) => (
            <span key={k} className="inline-flex items-baseline gap-1">
              <span aria-hidden className="text-[14px]" style={{ color: PRE_STATUS[k].color }}>
                {PRE_STATUS[k].icon}
              </span>
              <span className="text-[24px] font-semibold leading-none tracking-tight text-ink">{c[k]}</span>
              <span className="text-[11.5px] text-ink-3">{PRE_STATUS[k].label.toLowerCase()}</span>
            </span>
          ))}
      </div>
      <SegBar happened={c.happened} partial={c.partial} n={all.length} className="mt-3" />
    </div>
  );
}

/** Progress as status segments: happened (good) + partial (warn, hatched) over a neutral track. */
function SegBar({ happened, partial, n, className = '' }: { happened: number; partial: number; n: number; className?: string }) {
  const h = n ? (happened / n) * 100 : 0;
  const p = n ? (partial / n) * 100 : 0;
  return (
    <div className={`flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3 ${className}`} role="img" aria-label={`${happened} of ${n} happened, ${partial} partial`}>
      {h > 0 && <div style={{ width: `${h}%`, background: 'var(--good)' }} className="h-full" />}
      {p > 0 && <div style={{ width: `${p}%`, background: 'repeating-linear-gradient(135deg, var(--warn) 0 3px, color-mix(in oklab, var(--warn) 45%, transparent) 3px 6px)', marginLeft: h > 0 ? 2 : 0 }} className="h-full" />}
    </div>
  );
}

/** Filter row + the stepped path it scopes. */
function FilteredPath({ data }: { data: Ai2040 }) {
  const { stages, plans } = data;
  const [f, setF] = useState<Ai2040Filter>(AI2040_EMPTY);
  const set = useCallback(<K extends keyof Ai2040Filter>(k: K, v: Ai2040Filter[K]) => setF((prev) => ({ ...prev, [k]: v })), []);
  const clear = useCallback(() => setF(AI2040_EMPTY), []);
  const view = useMemo(() => filterAi2040(stages, plans, f), [stages, plans, f]);
  const yearDomain = useMemo<[number, number]>(() => [stages[0].year, Math.max(stages[stages.length - 1].year, stages[0].year + 1)], [stages]);

  // Status counts: preconditions in the year / plan scope that pass the search.
  const statusOpts = useMemo<Option[]>(() => {
    const q = f.q.trim();
    const pool = view.shown.flatMap((m) => m.stage.preconditions.filter((p) => !q || textMatch(`${p.text} ${p.evidence ?? ''}`, q) || m.titleHit));
    const n = countBy(pool, (p) => p.status);
    const present = new Set(stages.flatMap((s) => s.preconditions.map((p) => p.status)));
    return PRE_ORDER.filter((k) => present.has(k)).map((k) => ({ value: k, label: PRE_STATUS[k].label, count: n.get(k) ?? 0, glyph: PRE_STATUS[k].icon, color: PRE_STATUS[k].color }));
  }, [view, f.q, stages]);
  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? id;
  const pills = compact([
    textPill('q', f.q, () => set('q', '')),
    multiPill('statuses', 'Status', f.statuses, (k) => PRE_STATUS[k as PreconditionStatus]?.label ?? k, () => set('statuses', [])),
    rangePill('years', 'Years', f.years, yearDomain, String, () => set('years', {})),
    multiPill('plans', 'Plan', f.plans, planName, () => set('plans', [])),
  ]);
  const togglePlan = (id: string) => set('plans', f.plans.includes(id) ? f.plans.filter((x) => x !== id) : [...f.plans, id]);

  return (
    <>
      <FilterRow pills={pills} onClearAll={clear} count={view.matchedCount} total={stages.length} noun="stages">
        <SearchInput value={f.q} onChange={(v) => set('q', v)} placeholder="Search stages, preconditions…" className="w-full sm:w-60" />
        <MultiSelect label="Status" options={statusOpts} value={f.statuses} onChange={(v) => set('statuses', v)} width={230} />
        <RangeFilter label="Years" domain={yearDomain} step={1} value={f.years} onChange={(v) => set('years', v)} />
        {plans.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Plans">
            <span className="kicker mr-0.5">Plan</span>
            {plans.map((p) => (
              <Chip key={p.id} active={f.plans.includes(p.id)} onClick={() => togglePlan(p.id)} title={p.subtitle ?? p.name}>
                {p.id.length <= 2 ? <span className="font-mono text-[11px] opacity-70">{p.id}</span> : null}
                {p.name}
              </Chip>
            ))}
          </div>
        )}
      </FilterRow>
      {ai2040Active(f) && view.matchedCount === 0 ? (
        <NoMatches onClear={clear}>No stage matches these filters.</NoMatches>
      ) : (
        <SteppedPath view={view} plans={plans} f={f} showFork={inRange(FORK_YEAR, f.years)} />
      )}
    </>
  );
}

function SteppedPath({ view, plans, f, showFork }: { view: Ai2040View; plans: Plan[]; f: Ai2040Filter; showFork: boolean }) {
  const reduce = useReducedMotion();
  const stages = view.shown;
  const hasForkStage = stages.some((m) => m.stage.year === FORK_YEAR);
  // No stage dated at the fork? Insert a standalone fork row before the first later stage.
  const forkIndex = plans.length && showFork && !hasForkStage ? stages.findIndex((m) => m.stage.year > FORK_YEAR) : -2;
  // A single picked plan opens the fork on it.
  const focusPlan = f.plans.length === 1 ? f.plans[0] : undefined;
  const staged = plans.find((p) => p.id === stagedPlanId(plans));
  const filtering = !!f.q.trim() || f.statuses.length > 0;
  return (
    <ol className="relative">
      <div aria-hidden className="absolute bottom-3 left-[27px] top-3 w-px bg-gradient-to-b from-[var(--glow-a)] via-[var(--line-2)] to-[var(--glow-b)] opacity-70 sm:left-[35px]" />
      {stages.map((m, i) => (
        <Fragment key={`${m.stage.year}-${m.stage.title}`}>
          {i === forkIndex && <ForkRow plans={plans} focus={focusPlan} />}
          <motion.li
            className={`relative pl-[64px] sm:pl-[80px] ${m.matched ? 'pb-5' : 'pb-3'}`}
            initial={reduce ? false : { opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.3, delay: Math.min(i, 4) * 0.04 }}
          >
            <StageCard m={m} q={f.q} filtering={filtering} fork={m.stage.year === FORK_YEAR && plans.length > 0 ? plans : null} focusPlan={focusPlan} />
          </motion.li>
        </Fragment>
      ))}
      {forkIndex === -1 && <ForkRow plans={plans} focus={focusPlan} />}
      {view.afterForkHidden && staged && (
        <li className="relative pb-2 pl-[64px] sm:pl-[80px]">
          <div className="rounded-2xl border border-dashed border-line-2 px-4 py-3 text-[12.5px] leading-relaxed text-ink-3">
            Stages after {FORK_YEAR} follow Plan {staged.id} ({staged.name}), which isn’t in the plan filter. The other plans aren’t staged on this page
            {f.plans.length === 1 && plans.find((p) => p.id === f.plans[0])?.url ? (
              <>
                {': '}
                <ExtLink href={plans.find((p) => p.id === f.plans[0])!.url!}>explore Plan {f.plans[0]}</ExtLink>
              </>
            ) : null}
            .
          </div>
        </li>
      )}
    </ol>
  );
}

function YearPin({ year, fork }: { year: number; fork?: boolean }) {
  return (
    <div className="absolute left-0 top-1 flex w-[56px] flex-col items-center sm:w-[72px]">
      <span
        className={`rounded-full px-2 py-0.5 font-mono text-[12px] font-semibold ${
          fork ? 'bg-accent text-accent-ink shadow-[0_0_22px_-4px_var(--accent)]' : 'border border-line-2 bg-surface text-ink shadow-[0_0_18px_-6px_var(--glow-b)]'
        }`}
      >
        {year}
      </span>
      {fork && <span className="mt-1 font-mono text-[9.5px] tracking-[0.12em] text-ink-3">FORK</span>}
    </div>
  );
}

function StageCard({ m, q, filtering, fork, focusPlan }: { m: StageMatch; q: string; filtering: boolean; fork: Plan[] | null; focusPlan?: string }) {
  const s = m.stage;
  const sc = stageScore(s);
  const [expanded, setExpanded] = useState(false);
  const nHits = m.hits.filter(Boolean).length;
  if (!m.matched && !expanded)
    return (
      <>
        <YearPin year={s.year} fork={!!fork} />
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-dashed border-line px-4 py-2 opacity-70">
          <h3 className="min-w-0 text-[13px] font-medium leading-snug text-ink-2">{s.title}</h3>
          <span className="flex shrink-0 items-center gap-2 font-mono text-[10.5px] text-ink-3">
            no matches
            <button type="button" onClick={() => setExpanded(true)} className="rounded-full border border-line px-2 py-0.5 text-ink-2 hover:border-line-2 hover:text-ink" aria-label={`Show ${s.title}`}>
              show
            </button>
          </span>
        </div>
      </>
    );
  return (
    <>
      <YearPin year={s.year} fork={!!fork} />
      <div className={`rounded-2xl border bg-surface-2/60 p-4 transition-colors hover:border-line-2 ${fork ? 'border-line-2' : 'border-line'}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-[14.5px] font-semibold leading-snug tracking-tight text-ink">
            {s.url ? (
              <ExtLink href={s.url} className="no-underline hover:underline">
                <Hl text={s.title} q={q} />
              </ExtLink>
            ) : (
              <Hl text={s.title} q={q} />
            )}
          </h3>
          {sc.n > 0 && (
            <span className="tnum shrink-0 font-mono text-[11px] text-ink-3">
              {filtering ? `${nHits} of ${sc.n} match · ` : ''}
              {sc.happened}/{sc.n} happened{sc.partial ? ` · ${sc.partial} partial` : ''}
            </span>
          )}
        </div>
        {s.summary && (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
            <Hl text={s.summary} q={q} />
          </p>
        )}
        {fork && <ForkChips key={focusPlan ?? 'default'} plans={fork} focus={focusPlan} />}
        {sc.n > 0 && (
          <>
            <div className="kicker mb-1.5 mt-3.5">Needs · status today</div>
            <SegBar happened={sc.happened} partial={sc.partial} n={sc.n} />
            <ul className="mt-2.5 space-y-1.5">
              {s.preconditions.map((p, i) => {
                const st = PRE_STATUS[p.status];
                const hit = filtering && m.hits[i];
                return (
                  <li
                    key={i}
                    className={`-mx-1.5 flex items-start gap-2 rounded-lg px-1.5 text-[12.5px] leading-snug transition-opacity ${hit ? 'bg-[var(--accent-soft)] py-1 ring-1 ring-inset ring-[color-mix(in_oklab,var(--accent)_35%,transparent)]' : filtering ? 'opacity-45' : ''}`}
                  >
                    <span aria-label={st.label} title={st.label} className="mt-[1px] w-3.5 shrink-0 text-center text-[13px] leading-none" style={{ color: st.color }}>
                      {st.icon}
                    </span>
                    <span className="min-w-0">
                      <span className={p.status === 'happened' || hit ? 'text-ink' : 'text-ink-2'}>
                        <Hl text={p.text} q={q} />
                      </span>
                      {(p.evidence || p.url) && (
                        <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">
                          {p.evidence && <Hl text={p.evidence} q={q} />}
                          {p.url && (
                            <>
                              {p.evidence ? ' · ' : ''}
                              <ExtLink href={p.url}>{hostOf(p.url)}</ExtLink>
                            </>
                          )}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {s.branchPoints.length > 0 && (
          <div className="mt-3 border-t border-line pt-2.5 text-[11.5px] leading-snug text-ink-3">
            <span className="kicker mr-1.5">Off-ramps explored</span>
            {s.branchPoints.map((b, i) => (
              <span key={i} className="mt-1 block">
                <span aria-hidden>⤷ </span>
                {b}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ForkChips({ plans, focus }: { plans: Plan[]; focus?: string }) {
  const defaultPlan = plans.find((p) => p.id === stagedPlanId(plans));
  const [sel, setSel] = useState(focus ?? defaultPlan?.id);
  const cur = plans.find((p) => p.id === sel);
  const isA = cur?.id === defaultPlan?.id;
  return (
    <div className="mt-3 rounded-xl border border-dashed border-line-2 p-3">
      <div className="kicker mb-2">The fork · five plans</div>
      <div className="flex flex-wrap gap-1.5">
        {plans.map((p) => (
          <Chip key={p.id} active={p.id === sel} onClick={() => setSel(p.id)} title={p.subtitle ?? undefined}>
            {p.id.length <= 2 ? <span className="font-mono text-[11px] opacity-70">{p.id}</span> : null}
            {p.name}
          </Chip>
        ))}
      </div>
      <AnimatePresence mode="wait">
        {cur && (
          <motion.p key={cur.id} className="mt-2.5 text-[12.5px] leading-relaxed text-ink-2" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <span className="font-medium text-ink">
              {cur.id.length <= 2 ? `Plan ${cur.id}: ` : ''}
              {cur.name}
              {cur.subtitle ? ` (${cur.subtitle})` : ''}.
            </span>{' '}
            {cur.summary}
            {cur.url && (
              <>
                {' '}
                <ExtLink href={cur.url}>explore</ExtLink>
              </>
            )}
            {isA ? <span className="text-ink-3"> The stages on this page follow this branch.</span> : null}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function ForkRow({ plans, focus }: { plans: Plan[]; focus?: string }) {
  return (
    <li className="relative pb-5 pl-[64px] sm:pl-[80px]">
      <YearPin year={FORK_YEAR} fork />
      <ForkChips key={focus ?? 'default'} plans={plans} focus={focus} />
    </li>
  );
}

// ── Metric sparklines (Plan A's envisioned figures) ────────────────────────
function MetricCards({ metrics }: { metrics: Metric[] }) {
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const groups = new Map<string, Metric[]>();
  for (const m of metrics) groups.set(m.name, [...(groups.get(m.name) ?? []), m]);
  const list = [...groups.entries()].map(([name, pts]) => ({ name, pts: pts.sort((a, b) => a.year - b.year), note: pts.find((p) => p.note)?.note ?? null }));
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="kicker">Plan A’s sidebar figures</div>
        <Segmented
          label="Cards or table"
          value={view}
          onChange={setView}
          options={[
            { value: 'cards', label: 'Cards' },
            { value: 'table', label: 'Table' },
          ]}
        />
      </div>
      {view === 'cards' ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {list.map((g) => {
            const first = g.pts[0];
            const last = g.pts[g.pts.length - 1];
            const a = metricParts(first.value, first.unit);
            const b = metricParts(last.value, last.unit);
            return (
              <div key={g.name} className="rounded-xl border border-line bg-surface-2/60 p-3" title={g.note ?? undefined}>
                <div className="truncate text-[12px] font-medium text-ink-2">{g.name}</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-[20px] font-semibold leading-none tracking-tight text-ink">{b.value}</span>
                  {b.unit && <span className="text-[11px] text-ink-3">{b.unit}</span>}
                  <span className="ml-auto font-mono text-[10.5px] text-ink-3">{last.year}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-ink-3">
                  from {a.value}
                  {a.unit ? ` ${a.unit}` : ''} in {first.year}
                </div>
                <Sparkline pts={g.pts} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="max-h-[320px] overflow-auto rounded-xl border border-line">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-surface-2 text-left">
              <tr className="kicker">
                <th className="px-2.5 py-1.5 font-normal">Metric</th>
                <th className="px-2.5 py-1.5 font-normal">Year</th>
                <th className="px-2.5 py-1.5 text-right font-normal">Value</th>
              </tr>
            </thead>
            <tbody>
              {list.flatMap((g) =>
                g.pts.map((p) => (
                  <tr key={`${g.name}-${p.year}`} className="border-t border-line">
                    <td className="px-2.5 py-1 text-ink-2">{g.name}</td>
                    <td className="tnum px-2.5 py-1 text-ink-2">{p.year}</td>
                    <td className="tnum px-2.5 py-1 text-right text-ink">
                      {metricParts(p.value, p.unit).value} {metricParts(p.value, p.unit).unit ?? ''}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] leading-snug text-ink-3">What the scenario depicts under Plan A (start of each year), conditional on its policy choices. Not measurements.</p>
    </div>
  );
}

function Sparkline({ pts }: { pts: Metric[] }) {
  const w = 200;
  const h = 40;
  if (pts.length < 2) return <div className="mt-2 text-[11px] text-ink-3">single value</div>;
  const x0 = pts[0].year;
  const x1 = pts[pts.length - 1].year;
  const vs = pts.map((p) => p.value);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const x = (y: number) => 4 + ((y - x0) / (x1 - x0 || 1)) * (w - 8);
  const y = (v: number) => h - 6 - ((v - lo) / (hi - lo || 1)) * (h - 12);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.year).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h + 12}`} className="mt-2 block w-full" role="img" aria-label={pts.map((p) => `${p.year}: ${metricParts(p.value, p.unit).value}`).join(', ')}>
      <path d={d} fill="none" stroke="var(--text-2)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={p.year} cx={x(p.year)} cy={y(p.value)} r={i === pts.length - 1 ? 3 : 2} fill={i === pts.length - 1 ? 'var(--accent)' : 'var(--text-3)'}>
          <title>{`${p.year}: ${metricParts(p.value, p.unit).value} ${metricParts(p.value, p.unit).unit ?? ''}`.trim()}</title>
        </circle>
      ))}
      <text x={4} y={h + 10} fontSize="9" className="font-mono" fill="var(--text-3)">
        {x0}
      </text>
      <text x={w - 4} y={h + 10} fontSize="9" textAnchor="end" className="font-mono" fill="var(--text-3)">
        {x1}
      </text>
    </svg>
  );
}

/** Value + unit label, formatted by what the unit says. */
function metricParts(v: number, unit: string | null): { value: string; unit: string | null } {
  const u = unit?.trim() ?? '';
  if (/^pct$|^%$/i.test(u)) return { value: `${fmtNum(v)}%`, unit: null };
  const usd = /^usd(\d{4})?$/i.exec(u);
  if (usd) return { value: fmtUsd(v).replace(/\.0(?=[kMBT]$)/, ''), unit: usd[1] ? `${usd[1]} dollars` : null };
  if (/^x\b/i.test(u)) return { value: `${fmtNum(v)}×`, unit: u.replace(/^x\s*/i, '') || null };
  return { value: fmtNum(v), unit: u || null };
}

function fmtNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
  return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(a < 10 ? 2 : 1);
}
