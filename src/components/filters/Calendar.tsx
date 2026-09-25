import { useEffect, useMemo, useState } from 'react';
import { addMonths, monthGrid, todayIso } from '../../lib/filters.ts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

interface Props {
  /** Selected single date, or range endpoints. */
  from?: string;
  to?: string;
  range?: boolean;
  onPick: (iso: string) => void;
  /** ISO dates that carry data: drawn with a dot so you can aim at real events. */
  marks?: Set<string>;
  minYear?: number;
  maxYear?: number;
  /** Month to show first (ISO, any day). */
  initial?: string;
  months?: 1 | 2;
}

/** Month-grid calendar with year/month jump selects, range preview on hover and data marks. */
export function Calendar({ from, to, range = false, onPick, marks, minYear = 2016, maxYear = new Date().getFullYear() + 4, initial, months = 1 }: Props) {
  const [view, setView] = useState(() => (initial ?? from ?? to ?? todayIso()).slice(0, 7) + '-01');
  const [hover, setHover] = useState<string | null>(null);

  // Jump to the selection when it changes from outside (presets, typed dates) and is off-screen.
  useEffect(() => {
    const target = from ?? to;
    if (!target) return;
    const first = view.slice(0, 7);
    const last = addMonths(view, months - 1).slice(0, 7);
    const t = target.slice(0, 7);
    if (t < first || t > last) setView(`${t}-01`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);
  const today = todayIso();
  const years = useMemo(() => Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i), [minYear, maxYear]);

  // Range preview: while only `from` is set, hovering previews the span.
  const lo = range && from && !to && hover ? (hover < from ? hover : from) : from;
  const hi = range && from && !to && hover ? (hover < from ? from : hover) : to;

  const renderMonth = (monthIso: string, idx: number) => {
    const [y, m] = monthIso.split('-').map(Number);
    const cells = monthGrid(y, m - 1);
    return (
      <div key={monthIso} className="min-w-0 flex-1">
        <div className="mb-2 flex items-center justify-between gap-1">
          {idx === 0 ? (
            <button type="button" aria-label="Previous month" onClick={() => setView(addMonths(view, -1))} className="h-7 w-7 rounded-lg text-ink-2 hover:bg-surface-3 hover:text-ink">
              ‹
            </button>
          ) : (
            <span className="w-7" />
          )}
          {idx === 0 ? (
            <div className="flex items-center gap-1">
              <select
                aria-label="Month"
                value={m - 1}
                onChange={(e) => setView(`${y}-${String(Number(e.target.value) + 1).padStart(2, '0')}-01`)}
                className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[12px] text-ink"
              >
                {MONTHS.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
              <select aria-label="Year" value={y} onChange={(e) => setView(`${e.target.value}-${String(m).padStart(2, '0')}-01`)} className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[12px] text-ink">
                {years.map((yy) => (
                  <option key={yy} value={yy}>
                    {yy}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="text-[12.5px] font-medium">
              {MONTHS[m - 1]} {y}
            </div>
          )}
          {idx === months - 1 ? (
            <button type="button" aria-label="Next month" onClick={() => setView(addMonths(view, 1))} className="h-7 w-7 rounded-lg text-ink-2 hover:bg-surface-3 hover:text-ink">
              ›
            </button>
          ) : (
            <span className="w-7" />
          )}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5 text-center">
          {DOW.map((d) => (
            <div key={d} className="pb-1 font-mono text-[10px] text-ink-3">
              {d}
            </div>
          ))}
          {cells.map((iso, i) => {
            if (!iso) return <div key={`e${i}`} />;
            const isEnd = iso === lo || iso === hi || (!range && iso === from);
            const inSpan = range && lo && hi && iso > lo && iso < hi;
            const marked = marks?.has(iso);
            return (
              <button
                type="button"
                key={iso}
                onClick={() => onPick(iso)}
                onMouseEnter={() => setHover(iso)}
                onMouseLeave={() => setHover(null)}
                aria-pressed={isEnd}
                className={`relative mx-auto flex h-8 w-full items-center justify-center text-[12px] tnum transition-colors ${
                  isEnd ? 'rounded-lg bg-accent font-semibold text-accent-ink' : inSpan ? 'bg-[var(--accent-soft)] text-ink' : 'rounded-lg text-ink-2 hover:bg-surface-3 hover:text-ink'
                } ${iso === today && !isEnd ? 'ring-1 ring-inset ring-line-2' : ''}`}
              >
                {Number(iso.slice(8))}
                {marked && <span className={`absolute bottom-1 h-1 w-1 rounded-full ${isEnd ? 'bg-accent-ink' : 'bg-[var(--glow-b)]'}`} />}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return <div className="flex gap-4">{Array.from({ length: months }, (_, i) => renderMonth(addMonths(view, i), i))}</div>;
}
