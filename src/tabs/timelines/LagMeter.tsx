import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, useMemo, useRef } from 'react';
import { monthYear } from '../../lib/format.ts';
import { InfoTip } from '../../components/ui/misc.tsx';
import { forecasterMarks, isPrincipal, latestMedians } from './forecasts.ts';
import { fmtLag, monthsBetween, type LagSummary } from './lag.ts';
import type { ForecastUpdate, Milestone, Proxy } from './types.ts';
import { Code, effectiveStatus, EmptyState, lagVar, MILESTONE_STATUS } from './ui.tsx';

const MIN = -12;
const MAX = 36;
const W = 440;
const CX = 220;
const CY = 206;
const R = 158; // outer radius of the scale band
const BAND = 16;

const ang = (v: number) => Math.PI * (1 - (Math.min(MAX, Math.max(MIN, v)) - MIN) / (MAX - MIN));
const pt = (r: number, v: number): [number, number] => [CX + r * Math.cos(ang(v)), CY - r * Math.sin(ang(v))];
const f = (n: number) => n.toFixed(2);

function arcPath(r: number, v0: number, v1: number): string {
  const [x0, y0] = pt(r, v0);
  const [x1, y1] = pt(r, v1);
  return `M${f(x0)},${f(y0)} A${r},${r} 0 0 1 ${f(x1)},${f(y1)}`;
}
function bandSeg(v0: number, v1: number): string {
  const [a, b] = pt(R, v0);
  const [c, d] = pt(R, v1);
  const [e, g] = pt(R - BAND, v1);
  const [h, i] = pt(R - BAND, v0);
  return `M${f(a)},${f(b)} A${R},${R} 0 0 1 ${f(c)},${f(d)} L${f(e)},${f(g)} A${R - BAND},${R - BAND} 0 0 0 ${f(h)},${f(i)} Z`;
}

interface Props {
  summary: LagSummary;
  proxies: Proxy[];
  milestones: Milestone[];
  updates: ForecastUpdate[];
  now: string;
}

export function LagMeter({ summary, proxies, milestones, updates, now }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduce = useReducedMotion();
  const value = summary.months;
  const mv = useMotionValue(reduce ? value ?? 0 : MIN);

  useEffect(() => {
    if (value == null) return;
    if (reduce) {
      mv.set(value);
      return;
    }
    if (!inView) return;
    const c = animate(mv, value, { type: 'spring', stiffness: 42, damping: 9, mass: 1.1, delay: 0.15 });
    return () => c.stop();
  }, [inView, value, reduce, mv]);

  const needleX = useTransform(mv, (v) => pt(R - BAND - 14, v)[0]);
  const needleY = useTransform(mv, (v) => pt(R - BAND - 14, v)[1]);
  const sweep = useTransform(mv, (v) => (Math.abs(v) < 0.05 ? `M${CX},${CY}` : v >= 0 ? arcPath(R + 5, 0, v) : arcPath(R + 5, v, 0)));
  const sweepColor = useTransform(mv, (v) => lagVar(v));
  const readout = useTransform(mv, (v) => {
    const r = Math.abs(v) < 0.05 ? 0 : v;
    return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toFixed(1)}`;
  });

  const segs = useMemo(
    () =>
      Array.from({ length: MAX - MIN }, (_, i) => {
        const v0 = MIN + i;
        const mid = v0 + 0.5;
        const t = Math.min(1, Math.abs(mid) / 12);
        const pole = mid < 0 ? 'var(--tl-ahead)' : 'var(--tl-behind)';
        return { d: bandSeg(v0 + 0.06, v0 + 0.94), fill: `color-mix(in oklab, ${pole} ${Math.round(18 + t * 70)}%, var(--line-2))` };
      }),
    [],
  );

  // Authors' latest automated-coder medians, expressed as a lag vs the scenario's SC date.
  const sc = milestones.find((m) => m.id === 'superhuman-coder') ?? milestones.find((m) => /superhuman coder|automated coder/i.test(m.title));
  const acAll = latestMedians(updates, 'ac');
  const acLatest = acAll.some((u) => isPrincipal(u.forecaster)) ? acAll.filter((u) => isPrincipal(u.forecaster)) : acAll;
  const marks = forecasterMarks(acLatest.map((u) => u.forecaster));
  const acMarkers = sc ? acLatest.map((u) => ({ u, lag: monthsBetween(sc.date, u.median) })) : [];

  const graded = { hit: 0, partial: 0, 'not-yet': 0, missed: 0, future: 0, 'n/a': 0 } as Record<string, number>;
  for (const m of milestones) graded[effectiveStatus(m, now)]++;

  const counted = summary.lags.filter((l) => l.months != null);
  const behind = value != null && value >= 0.5;
  const ahead = value != null && value <= -0.5;

  return (
    <div ref={ref} className="grid grid-cols-1 items-center gap-6 lg:grid-cols-12">
      {/* ── Gauge ── */}
      <div className="relative lg:col-span-6 xl:col-span-5">
        <svg viewBox={`0 -8 ${W} ${CY + 30}`} className="mx-auto block w-full max-w-[520px]" role="img" aria-label={value == null ? 'Lag meter: no proxy data' : `Lag meter: reality is ${fmtLag(value, summary.atLeast)} relative to AI 2027 (positive = behind)`}>
          <defs>
            <filter id="lm-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id="lm-dish" cx="50%" cy="100%" r="75%">
              <stop offset="0" stopColor="var(--glow-b)" stopOpacity="0.14" />
              <stop offset="0.6" stopColor="var(--glow-a)" stopOpacity="0.05" />
              <stop offset="1" stopColor="var(--glow-a)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* dish */}
          <path d={`M${CX - R + BAND},${CY} A${R - BAND},${R - BAND} 0 0 1 ${CX + R - BAND},${CY} Z`} fill="url(#lm-dish)" />
          {[0.35, 0.62].map((k) => (
            <path key={k} d={arcPath((R - BAND) * k, MIN, MAX)} fill="none" stroke="var(--line)" strokeWidth="1" />
          ))}

          {/* diverging scale band */}
          {segs.map((s, i) => (
            <path key={i} d={s.d} style={{ fill: s.fill }} />
          ))}

          {/* ticks */}
          {Array.from({ length: (MAX - MIN) / 3 + 1 }, (_, i) => MIN + i * 3).map((v) => {
            const major = v % 12 === 0;
            const [x0, y0] = pt(R + 3, v);
            const [x1, y1] = pt(R + (major ? 14 : v % 6 === 0 ? 9 : 6), v);
            return <line key={v} x1={x0} y1={y0} x2={x1} y2={y1} stroke={v === 0 ? 'var(--text)' : major ? 'var(--text-3)' : 'var(--axis)'} strokeWidth={v === 0 ? 2 : 1} />;
          })}
          {[-12, 0, 12, 24, 36].map((v) => {
            const [x, y] = pt(R + 28, v);
            return (
              <text key={v} x={x} y={y + 4} textAnchor="middle" className="font-mono" fontSize="11" fill={v === 0 ? 'var(--text)' : 'var(--text-3)'}>
                {v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0'}
              </text>
            );
          })}
          <text x={pt(R - BAND - 12, -9)[0]} y={CY - 4} fontSize="10" className="font-mono" fill="var(--text-3)" textAnchor="start" letterSpacing="0.1em">
            AHEAD
          </text>
          <text x={pt(R - BAND - 12, 33)[0]} y={CY - 4} fontSize="10" className="font-mono" fill="var(--text-3)" textAnchor="end" letterSpacing="0.1em">
            BEHIND
          </text>

          {value != null && (
            <>
              {/* lower bound: the true value lies anywhere further along */}
              {summary.atLeast && <path d={arcPath(R + 5, value, MAX)} fill="none" stroke="var(--tl-behind)" strokeOpacity=".55" strokeWidth="2" strokeDasharray="3 5" />}
              <motion.path d={sweep} fill="none" stroke={sweepColor} strokeWidth="3" strokeLinecap="round" filter="url(#lm-glow)" />
              {/* needle */}
              <motion.line x1={CX} y1={CY} x2={needleX} y2={needleY} stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round" filter="url(#lm-glow)" />
              <circle cx={CX} cy={CY} r="9" fill="var(--surface-3)" stroke="var(--line-2)" />
              <circle cx={CX} cy={CY} r="3.5" fill="var(--accent)" />
            </>
          )}

          {/* authors' AC medians as lag markers */}
          {acMarkers.map(({ u, lag }) => {
            const off = lag > MAX;
            const [x, y] = pt(R - BAND - 4, lag);
            const [lx, ly] = pt(R - BAND - 16, lag);
            return (
              <g key={u.forecaster}>
                <title>{`${u.forecaster}: automated coder median ${monthYear(u.median)} (published ${monthYear(u.published)}) = ${fmtLag(lag)} vs the scenario's ${monthYear(sc!.date)}${off ? ' (off scale)' : ''}`}</title>
                <circle cx={x} cy={y} r="4.5" fill="var(--surface)" stroke="var(--text-2)" strokeWidth="1.5" />
                <text x={lx} y={ly + 3.5} fontSize="9.5" textAnchor="middle" className="font-mono" fill="var(--text-2)">
                  {u.forecaster.slice(0, 1).toUpperCase()}
                  {off ? '›' : ''}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="-mt-3 text-center">
          {value == null ? (
            <div className="text-[15px] text-ink-3">No lag yet</div>
          ) : (
            <>
              <div className="flex items-baseline justify-center gap-2">
                {summary.atLeast && <span className="text-[40px] font-semibold leading-none text-ink-2">≥</span>}
                <motion.span className="text-[56px] font-semibold leading-none tracking-tight text-ink">{readout}</motion.span>
                <span className="text-[18px] font-medium text-ink-2">months</span>
              </div>
              <div className="mt-2 text-[13px] text-ink-2">
                {behind ? 'behind' : ahead ? 'ahead of' : 'roughly on'} the AI 2027 schedule
                <span className="text-ink-3"> · weighted median of {summary.counted} proxies</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:col-span-6 xl:col-span-7">
        {proxies.length === 0 ? (
          <EmptyState title="No proxies yet" className="sm:col-span-2">
            Curated file missing or empty: <Code>data/curated/ai2027-proxies.yaml</Code>. Then run <Code>npm run build:data</Code>.
          </EmptyState>
        ) : (
          <div className="min-w-0">
            <div className="kicker mb-1.5">Proxies reached</div>
            <div className="text-[26px] font-semibold leading-none tracking-tight text-ink">
              {summary.reached}
              <span className="text-ink-3"> / {summary.total}</span>
            </div>
            <div className="mt-1.5 text-[12px] text-ink-3">
              {[summary.projected && `${summary.projected} projected`, summary.lowerBound && `${summary.lowerBound} lower bound`, summary.excluded && `${summary.excluded} not countable yet`].filter(Boolean).join(' · ') || 'all observed'}
            </div>
          </div>
        )}

        <div className="min-w-0">
          <div className="kicker mb-1.5">Milestones graded</div>
          {milestones.length === 0 ? (
            <div className="text-[13px] text-ink-3">
              Curated file missing: <Code>data/curated/ai2027.yaml</Code>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
                {(['hit', 'partial', 'not-yet', 'missed'] as const).map((k) => (
                  <span key={k} className="inline-flex items-baseline gap-1" title={MILESTONE_STATUS[k].label}>
                    <span aria-hidden className="text-[15px]" style={{ color: MILESTONE_STATUS[k].color }}>
                      {MILESTONE_STATUS[k].icon}
                    </span>
                    <span className="text-[26px] font-semibold leading-none tracking-tight text-ink">{graded[k]}</span>
                    <span className="text-[11.5px] text-ink-3">{MILESTONE_STATUS[k].label.toLowerCase()}</span>
                  </span>
                ))}
              </div>
              <div className="mt-1.5 text-[12px] text-ink-3">
                {graded.future} still in the future{graded['n/a'] ? ` · ${graded['n/a']} ungraded` : ''}
              </div>
            </>
          )}
        </div>

        <div className="min-w-0">
          <div className="kicker mb-1.5 flex items-center gap-1.5">
            Authors’ current median · automated coder
            <InfoTip align="left">
              The latest published median per forecaster from <Code>ai2027-updates.yaml</Code>. On the dial, each forecaster’s marker shows that median as a lag against the scenario’s superhuman-coder date
              {sc ? ` (${monthYear(sc.date)})` : ''}. A “›” means it is off the scale.
            </InfoTip>
          </div>
          {acLatest.length === 0 ? (
            <div className="text-[13px] text-ink-3">
              No forecast updates yet: <Code>data/curated/ai2027-updates.yaml</Code>
            </div>
          ) : (
            <div className="space-y-1">
              {acLatest.map((u) => (
                <div key={u.forecaster} className="flex items-baseline gap-2">
                  <span aria-hidden className="text-[10px] text-ink-3">
                    {marks.get(u.forecaster)?.glyph}
                  </span>
                  <span className="text-[22px] font-semibold leading-none tracking-tight text-ink">{monthYear(u.median)}</span>
                  <span className="text-[12px] text-ink-3">
                    {u.forecaster} · as of {monthYear(u.published)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="kicker mb-1.5 flex items-center gap-1.5">
            Spread across proxies
            <InfoTip align="right">
              <b className="text-ink">Method.</b> Each proxy is a measurable value from the scenario (compute, revenue, time horizon…). Lag = the date reality reached that value − the date the AI 2027 path reached it, in months (+
              = behind). If reality hasn’t got there yet, a still-future projected date is used; otherwise “now − scenario date” is a lower bound, marked ≥. Unreached proxies whose scenario date is still ahead are left
              out. The headline is the weighted median (weight 0.5 = fuzzy proxy); it is flagged ≥ when a lower bound could still move it.
            </InfoTip>
          </div>
          {counted.length === 0 ? <div className="text-[13px] text-ink-3">Nothing to plot yet.</div> : <LagStrip summary={summary} proxies={proxies} />}
        </div>
      </div>
    </div>
  );
}

/** One dot per proxy on the same −12…+36 scale as the dial, so the median never hides the spread. */
function LagStrip({ summary, proxies }: { summary: LagSummary; proxies: Proxy[] }) {
  const w = 300;
  const h = 46;
  const x = (v: number) => 6 + ((Math.min(MAX, Math.max(MIN, v)) - MIN) / (MAX - MIN)) * (w - 12);
  const name = (id: string) => proxies.find((p) => p.id === id)?.name ?? id;
  const rows = summary.lags.filter((l) => l.months != null).sort((a, b) => a.months! - b.months!);
  // simple 2-row dodge for near-coincident dots
  let lastX = -99;
  let row = 0;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="block w-full max-w-[420px]" role="img" aria-label="Per-proxy lags on a −12 to +36 month scale">
      <line x1={x(MIN)} x2={x(MAX)} y1={22} y2={22} stroke="var(--axis)" />
      <line x1={x(0)} x2={x(0)} y1={8} y2={34} stroke="var(--text-3)" />
      {summary.months != null && <line x1={x(summary.months)} x2={x(summary.months)} y1={4} y2={38} stroke="var(--text)" strokeWidth="1.5" strokeDasharray="2 2" />}
      {rows.map((l) => {
        const cx = x(l.months!);
        row = cx - lastX < 7 ? 1 - row : 0;
        lastX = cx;
        const cy = row ? 29 : 15;
        return (
          <g key={l.id}>
            <title>{`${name(l.id)}: ${fmtLag(l.months, l.atLeast)}${l.kind === 'projected' ? ' (projected)' : ''} · weight ${l.weight}`}</title>
            <circle cx={cx} cy={cy} r={l.weight >= 1 ? 4.5 : 3.5} fill={l.kind === 'reached' ? lagVar(l.months) : 'var(--surface)'} stroke={lagVar(l.months)} strokeWidth="1.5" strokeDasharray={l.kind === 'reached' ? undefined : '2 1.5'} />
            {l.atLeast && <path d={`M${cx + 6},${cy - 3} l4,3 l-4,3`} fill="none" stroke={lagVar(l.months)} strokeWidth="1.2" />}
          </g>
        );
      })}
      {[-12, 0, 12, 24, 36].map((v) => (
        <text key={v} x={x(v)} y={h - 1} fontSize="9" textAnchor="middle" className="font-mono" fill="var(--text-3)">
          {v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0'}
        </text>
      ))}
    </svg>
  );
}
