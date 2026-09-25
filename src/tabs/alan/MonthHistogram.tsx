import { useRef, useState, type KeyboardEvent } from 'react';
import { isDateActive, summarizeDate, type DateFilterValue } from '../../lib/filters.ts';
import { monthYear } from '../../lib/format.ts';
import { binInDate, type HistBin } from './feedModel.ts';

const binLabel = (b: HistBin) => (b.from === null ? `Up to ${monthYear(b.to)}` : monthYear(b.from));

/**
 * Overview strip: one bar per month (bar height = entries matching every filter except
 * date). Click selects a month, shift-click extends the range, the current date filter's
 * months are lit. Arrow keys move between bars (one tab stop for the whole strip).
 */
export function MonthHistogram({ bins, earlier, date, onPick, noun = 'entries' }: { bins: HistBin[]; earlier: HistBin | null; date: DateFilterValue; onPick: (bin: HistBin, extend: boolean) => void; noun?: string }) {
  const all = earlier ? [earlier, ...bins] : bins;
  const max = Math.max(1, ...all.map((b) => b.count));
  const active = isDateActive(date);
  const [hover, setHover] = useState<HistBin | null>(null);
  const [focusIdx, setFocusIdx] = useState(all.length - 1);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent) => {
    const next = e.key === 'ArrowRight' ? focusIdx + 1 : e.key === 'ArrowLeft' ? focusIdx - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const i = Math.max(0, Math.min(all.length - 1, next));
    setFocusIdx(i);
    refs.current[i]?.focus();
  };

  const bar = (b: HistBin, i: number) => {
    const sel = active && binInDate(b, date);
    const h = b.count ? `max(3px, ${(b.count / max) * 100}%)` : '1px';
    return (
      <button
        key={b.key}
        ref={(el) => {
          refs.current[i] = el;
        }}
        type="button"
        tabIndex={i === focusIdx ? 0 : -1}
        aria-pressed={sel}
        aria-label={`${binLabel(b)}: ${b.count} ${noun}. Click to filter, shift-click to extend the range.`}
        onClick={(e) => onPick(b, e.shiftKey)}
        onMouseEnter={() => setHover(b)}
        onFocus={() => (setHover(b), setFocusIdx(i))}
        onBlur={() => setHover(null)}
        className={`group relative flex h-full min-w-0 items-end focus-visible:rounded-sm focus-visible:outline-offset-1 ${b.from === null ? 'flex-[3]' : 'flex-1'}`}
      >
        <span
          className={`w-full rounded-t-[2px] transition-[height,background-color] duration-300 ease-out ${
            sel ? 'bg-accent shadow-[0_0_12px_-2px_var(--accent)]' : active ? 'bg-ink-3/35 group-hover:bg-ink-2' : b.count ? 'bg-ink-3/75 group-hover:bg-ink' : 'bg-line-2'
          } ${b.from === null ? 'bg-[repeating-linear-gradient(135deg,transparent_0_3px,color-mix(in_oklab,var(--bg)_50%,transparent)_3px_5px)]' : ''}`}
          style={{ height: h }}
        />
      </button>
    );
  };

  return (
    <div className="select-none">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-[11.5px]">
        <span className="kicker shrink-0">{noun} per month</span>
        <span className="min-w-0 truncate text-right text-ink-3" aria-live="polite">
          {hover ? (
            <>
              <span className="font-medium text-ink">{binLabel(hover)}</span> · <span className="font-mono tnum">{hover.count}</span> {noun}
            </>
          ) : active ? (
            <>
              <span className="text-ink-2">{summarizeDate(date)}</span> · shift-click to extend
            </>
          ) : (
            <>
              <span className="hidden sm:inline">Click a month to filter · shift-click to extend</span>
              <span className="sm:hidden">Tap a month to filter</span>
            </>
          )}
        </span>
      </div>
      <div role="toolbar" aria-label={`${noun} per month`} onKeyDown={onKey} onMouseLeave={() => setHover(null)} className="flex h-16 items-end gap-[2px]">
        {earlier && (
          <>
            {bar(earlier, 0)}
            <span aria-hidden className="mx-0.5 h-full w-px shrink-0 bg-line-2" />
          </>
        )}
        {bins.map((b, i) => bar(b, i + (earlier ? 1 : 0)))}
      </div>
      {/* Axis: same flex structure as the bars so labels line up without measuring. */}
      <div aria-hidden className="mt-1.5 flex h-3.5 gap-[2px] font-mono text-[10px] text-ink-3">
        {earlier && (
          <>
            <span className="relative flex-[3]">
              <span className="absolute left-0 whitespace-nowrap">≤’{earlier.to.slice(2, 4)}</span>
            </span>
            <span className="mx-0.5 w-px shrink-0" />
          </>
        )}
        {bins.map((b, i) => (
          <span key={b.key} className="relative min-w-0 flex-1">
            {(b.key.endsWith('-01') || (i === 0 && !bins.some((x, j) => j < 6 && x.key.endsWith('-01')))) && <span className="absolute left-0 whitespace-nowrap border-l border-line-2 pl-1">{b.key.slice(0, 4)}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
