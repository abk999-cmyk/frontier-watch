import { AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { AsiStatus } from '../../shared/types.ts';
import { EChart } from '../charts/EChart.tsx';
import { Panel } from '../components/ui/Panel.tsx';
import { Segmented } from '../components/ui/Segmented.tsx';
import { InfoTip, Skeleton, Stat } from '../components/ui/misc.tsx';
import { useAlan } from '../lib/data.ts';
import { monthYear, toTime } from '../lib/format.ts';
import type { Tokens } from '../lib/tokens.ts';
import { AsiGrid } from './alan/AsiGrid.tsx';
import { asiScore, replayMonths, statusesAt } from './alan/asiStatus.ts';
import { Feed } from './alan/Feed.tsx';
import { STATUS_META } from './alan/ui.tsx';

const AgiOrb = lazy(() => import('../components/three/AgiOrb.tsx'));
const AsiConstellation = lazy(() => import('../components/three/AsiConstellation.tsx'));

export default function AlanTab() {
  const { agi, asi } = useAlan();
  const latestMove = [...agi.log].find((l) => l.kind === 'pct');
  const yearAgo = agi.history.filter((h) => toTime(h.date) <= Date.now() - 365 * 864e5).at(-1);
  const gained12 = yearAgo ? agi.value - yearAgo.value : null;

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-1 items-end gap-6 pt-2 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div className="kicker mb-3">Dr Alan D. Thompson · LifeArchitect.ai · scraped {monthYear(agi.fetchedAt.slice(0, 10))}</div>
          <h1 className="text-[34px] font-semibold leading-[1.05] tracking-tight sm:text-[46px]">
            The countdown is at <span className="text-aurora">{agi.value}%</span>.
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">
            Alan's conservative countdown to AGI (a machine that can do what an average human can) and his 50 indicators of superintelligence, pulled live from his site. The history and evidence feeds come straight from his logs.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4 lg:col-span-5">
          <Stat label="AGI" value={`${agi.value}%`} sub={`updated ${monthYear(agi.lastUpdate)}`} />
          <Stat label="Last 12 months" value={gained12 === null ? '—' : `+${gained12} pts`} sub={yearAgo ? `from ${yearAgo.value}%` : undefined} />
          <Stat label="ASI achieved" value={`${asi.items.filter((i) => i.status === 'achieved').length}/50`} sub={`${asi.items.filter((i) => i.status === 'partial').length} partial`} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Panel className="lg:col-span-5" kicker="AGI countdown" title="Conservative countdown to AGI" footer={<>Gauge value read from Alan's page (<code>gauge.set({agi.value})</code>). Latest move: {latestMove ? `${latestMove.value}% · ${latestMove.title}` : '—'}</>}>
          <div className="relative h-[360px]">
            <Suspense fallback={<Skeleton h={360} />}>
              <AgiOrb value={agi.value} />
            </Suspense>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[64px] font-semibold leading-none tracking-tighter text-ink" style={{ textShadow: 'var(--hero-shadow)' }}>{agi.value}%</div>
              <div className="kicker mt-2">to AGI</div>
            </div>
          </div>
        </Panel>
        <AgiHistory />
      </div>

      <AsiSection />

      <Feed />
    </div>
  );
}

function AgiHistory() {
  const { agi } = useAlan();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  // Collapse to one point per month (the highest value reached that month).
  const series = useMemo(() => {
    const byMonth = new Map<string, { date: string; value: number; summary: string }>();
    for (const h of agi.history) {
      const prev = byMonth.get(h.date);
      if (!prev || h.value >= prev.value) byMonth.set(h.date, h);
    }
    return [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [agi.history]);

  const option = useCallback(
    (t: Tokens) => ({
      grid: { left: 44, right: 20, top: 24, bottom: 56 },
      tooltip: {
        trigger: 'axis',
        formatter: (ps: any[]) => {
          const p = ps[0];
          const h = series[p.dataIndex];
          return `<div style="max-width:280px;white-space:normal"><div style="font-family:${t.mono};font-size:11px;color:${t.text3}">${monthYear(h.date)}</div><div style="font-size:18px;font-weight:600;margin:2px 0">${h.value}%</div><div style="color:${t.text2};font-size:12px">${h.summary}</div></div>`;
        },
      },
      xAxis: { type: 'time', splitLine: { show: false } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8, borderColor: t.line, fillerColor: t.line2, backgroundColor: 'transparent', dataBackground: { lineStyle: { color: t.text3 }, areaStyle: { color: t.line } }, textStyle: { color: t.text3 } }],
      series: [
        {
          type: 'line',
          step: 'end',
          data: series.map((h) => [h.date, h.value]),
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { width: 2, color: t.accent },
          itemStyle: { color: t.accent, borderColor: t.surface, borderWidth: 2 },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: t.accent + '55' }, { offset: 1, color: t.accent + '00' }] } },
          markLine: {
            symbol: 'none',
            silent: true,
            lineStyle: { color: t.text3, type: 'dashed', width: 1 },
            label: { color: t.text3, fontFamily: t.mono, fontSize: 10, formatter: '{b}' },
            data: [{ yAxis: 100, name: 'AGI' }, { yAxis: 50, name: 'halfway' }],
          },
          markPoint: {
            symbol: 'circle',
            symbolSize: 10,
            itemStyle: { color: t.accent },
            label: { show: true, position: 'left', color: t.text, fontWeight: 600, formatter: `${agi.value}%` },
            data: [{ coord: [series.at(-1)!.date, series.at(-1)!.value] }],
          },
        },
      ],
    }),
    [series, agi.value],
  );

  return (
    <Panel
      className="lg:col-span-7"
      kicker="Countdown history"
      title={`From ${series[0]?.value}% in ${series[0] ? monthYear(series[0].date).split(' ')[1] : ''} to ${agi.value}% today`}
      actions={<Segmented value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />}
      footer={`${agi.history.length} dated moves parsed from Alan's countdown log. Drag the slider or scroll to zoom.`}
    >
      {view === 'chart' ? (
        <EChart option={option} height={360} ariaLabel="AGI countdown percentage over time" />
      ) : (
        <div className="h-[360px] overflow-y-auto rounded-xl border border-line">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-surface-2 text-left text-ink-3">
              <tr>
                <th className="px-3 py-2 font-medium">Month</th>
                <th className="px-3 py-2 font-medium">%</th>
                <th className="px-3 py-2 font-medium">Why it moved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...agi.history].reverse().map((h, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-ink-3">{monthYear(h.date)}</td>
                  <td className="px-3 py-2 font-mono font-semibold tnum">{h.value}</td>
                  <td className="px-3 py-2 text-ink-2">{h.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AsiSection() {
  const { asi } = useAlan();
  const months = useMemo(() => replayMonths(asi.events, asi.fetchedAt.slice(0, 7) + '-01'), [asi]);
  const [idx, setIdx] = useState(months.length); // months.length = "today"
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<'orbit' | 'grid'>('orbit');
  const asOf = idx >= months.length ? null : months[idx];
  const statuses = useMemo(() => statusesAt(asi.items, asi.events, asOf), [asi, asOf]);
  const score = asiScore(statuses);
  const counts = { achieved: 0, partial: 0, none: 0 } as Record<AsiStatus, number>;
  for (const s of statuses.values()) counts[s]++;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setIdx((i) => {
        if (i >= months.length) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 260);
    return () => clearInterval(id);
  }, [playing, months.length]);

  const legend = (['achieved', 'partial', 'none'] as const).map((s) => (
    <span key={s} className="inline-flex items-center gap-2 text-ink-2">
      <span style={{ color: STATUS_META[s].color }}>{STATUS_META[s].icon}</span>
      <span className="font-mono tnum text-ink">{counts[s]}</span> {STATUS_META[s].label}
    </span>
  ));
  const sel = asi.items.find((i) => i.id === selected);
  const selLog = sel ? asi.log.filter((l) => l.ids.some((x) => x.id === sel.id)).slice(0, 4) : [];
  const phaseStats = ([1, 2, 3] as const).map((p) => {
    const its = asi.items.filter((i) => i.phase === p);
    const s = its.reduce((acc, i) => acc + (statuses.get(i.id) === 'achieved' ? 1 : statuses.get(i.id) === 'partial' ? 0.5 : 0), 0);
    return { p, n: its.length, pct: (s / its.length) * 100 };
  });

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <Panel
        className="lg:col-span-8"
        kicker="ASI checklist · 50 indicators"
        title={
          <span className="inline-flex items-center gap-2">
            Superintelligence constellation
            <InfoTip>
              Alan's 50 ASI indicators in three phases, one orbital ring per phase (inner = discovery &amp; simulation, middle = governance &amp; economy, outer = physical world). ● achieved, ◐ partially achieved, ○ not yet. Drag to orbit; click a node for its evidence. The replay rebuilds past status from Alan's own animation log.
            </InfoTip>
          </span>
        }
        actions={<Segmented value={view} onChange={setView} options={[{ value: 'orbit', label: '3D orbit' }, { value: 'grid', label: 'Grid' }]} />}
      >
        <div className="relative">
          {view === 'orbit' ? (
            <>
              <div className="h-[460px]">
                <Suspense fallback={<Skeleton h={460} />}>
                  <AsiConstellation items={asi.items} statuses={statuses} score={score} selected={selected} onSelect={setSelected} />
                </Suspense>
              </div>
              <div className="pointer-events-none absolute left-0 top-0 flex flex-col gap-1.5 text-[12px]">{legend}</div>
            </>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">{legend}</div>
              <AsiGrid statuses={statuses} selected={selected} onSelect={setSelected} />
            </>
          )}
        </div>

        {/* Replay scrubber */}
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => {
              if (idx >= months.length) setIdx(0);
              setPlaying((p) => !p);
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-accent-ink shadow-[0_0_20px_-4px_var(--accent)]"
            aria-label={playing ? 'Pause replay' : 'Play replay'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={months.length}
            value={idx}
            onChange={(e) => (setPlaying(false), setIdx(Number(e.target.value)))}
            className="h-1 flex-1 cursor-pointer accent-[var(--accent)]"
            aria-label="Replay date"
          />
          <div className="w-[92px] shrink-0 text-right font-mono text-[12px] text-ink">{asOf ? monthYear(asOf) : 'Today'}</div>
        </div>
      </Panel>

      <Panel className="lg:col-span-4" kicker={asOf ? `As of ${monthYear(asOf)}` : 'Today'} title="Progress to ASI">
        <div className="flex items-end gap-3">
          <div className="text-[44px] font-semibold leading-none tracking-tight">{score.toFixed(0)}%</div>
          <div className="pb-1 text-[12px] text-ink-3">
            our calc · ● = 1, ◐ = ½
            <InfoTip className="ml-1">Alan doesn't publish an overall ASI percentage, only "{counts.achieved}/50 achieved". This score is our derivation: each achieved indicator counts 1, partial ½, out of 50.</InfoTip>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {phaseStats.map(({ p, n, pct }) => (
            <div key={p}>
              <div className="mb-1 flex justify-between text-[12px] text-ink-2">
                <span>{['Discovery & simulation', 'Governance & economy', 'Physical world'][p - 1]}</span>
                <span className="font-mono tnum text-ink-3">
                  {pct.toFixed(0)}% · {n} items
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <motion.div className="h-full rounded-full bg-accent" initial={false} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <AnimatePresence mode="wait">
            {sel ? (
              <motion.div key={sel.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="kicker mb-1">
                  #{sel.id} · {sel.type} · phase {sel.phase}
                </div>
                <div className="text-[15px] font-semibold leading-snug">{sel.label}</div>
                <div className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] text-ink-2">
                  <span style={{ color: STATUS_META[statuses.get(sel.id)!].color }}>{STATUS_META[statuses.get(sel.id)!].icon}</span>
                  {STATUS_META[statuses.get(sel.id)!].label}
                  {sel.lastUpdated && <span className="text-ink-3">· last updated {sel.lastUpdated}</span>}
                </div>
                {sel.notes && <p className="mt-2 text-[12.5px] text-ink-2">{sel.notes}</p>}
                {selLog.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {selLog.map((l, i) => (
                      <li key={i} className="rounded-lg border border-line bg-surface-2/60 p-2.5 text-[12px]">
                        <div className="font-mono text-[10.5px] text-ink-3">{monthYear(l.date)}</div>
                        <div className="text-ink">{l.title}</div>
                        {l.links[0] && (
                          <a href={l.links[0].url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-ink-3 underline underline-offset-2 hover:text-ink">
                            {l.links[0].label} ↗
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {sel.links.length > 0 && selLog.length === 0 && (
                  <div className="mt-2 space-y-1">
                    {sel.links.map((u) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer" className="block break-all text-[12px] text-ink-3 underline underline-offset-2 hover:text-ink">
                        {u}
                      </a>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[12.5px] text-ink-3">
                Click any node to inspect an indicator and Alan's evidence for it. Press ▶ to replay how the checklist lit up since mid-2022.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </Panel>
    </div>
  );
}
