import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Drawer } from '../../components/ui/misc.tsx';
import { highlightParts } from '../../lib/filters.ts';
import type { AsiStatus } from '../../../shared/types.ts';

export const STATUS_META: Record<AsiStatus, { label: string; icon: string; color: string }> = {
  achieved: { label: 'Achieved', icon: '●', color: 'var(--good)' },
  partial: { label: 'Partial', icon: '◐', color: 'var(--warn)' },
  none: { label: 'Not yet', icon: '○', color: 'var(--text-3)' },
};

/** Height of the app's sticky header, so sticky rails and month headers dock just beneath it. */
export function useHeaderOffset(fallback = 64) {
  const [h, setH] = useState(fallback);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('header.sticky');
    if (!el) return;
    const update = () => setH(Math.round(el.getBoundingClientRect().height));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return h;
}

/** Press "/" anywhere (outside a text field) to focus the search input inside `ref`. */
export function useSlashFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const input = ref.current?.querySelector('input');
      if (!input || input.offsetParent === null) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ref]);
}

/** Width of an element, tracked with a ResizeObserver. */
export function useWidth(ref: RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Search hits wrapped in <mark>. */
export function Highlight({ text, q }: { text: string; q: string }) {
  if (!q.trim() || !text) return <>{text}</>;
  return (
    <>
      {highlightParts(text, q).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-[3px] bg-[var(--accent-soft)] px-[1px] text-ink shadow-[inset_0_-1px_0_color-mix(in_oklab,var(--accent)_60%,transparent)]">
            {p.t}
          </mark>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </>
  );
}

/** Paragraph clamped to N lines with a "Read more" toggle that only appears when the text actually overflows. */
export function ClampText({ children, className = '', lines = 2 }: { children: ReactNode; className?: string; lines?: 1 | 2 | 3 }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setOverflow(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, children]);
  const clamp = lines === 1 ? 'line-clamp-1' : lines === 3 ? 'line-clamp-3' : 'line-clamp-2';
  return (
    <div>
      <p ref={ref} className={`${className} ${open ? '' : clamp}`}>
        {children}
      </p>
      {(overflow || open) && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 text-[11.5px] font-medium text-ink-3 underline decoration-line-2 underline-offset-2 hover:text-ink">
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  );
}

/** One labelled block in a filter rail. */
export function RailGroup({ label, hint, children, action }: { label: ReactNode; hint?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div role="group" aria-label={typeof label === 'string' ? label : undefined} className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="kicker">{label}</div>
        {action}
      </div>
      {children}
      {hint && <p className="mt-2 text-[11px] leading-snug text-ink-3">{hint}</p>}
    </div>
  );
}

/** Full-width wrapper so kit popover triggers fill the rail. */
export function RailField({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 [&>button]:max-w-full [&>button]:grow [&>button>span:last-child]:ml-auto">{children}</div>;
}

/**
 * Unboxed filter layout: a sticky filter rail on desktop, a "Filters (n)" button that
 * opens the same rail in a Drawer on mobile, and the results column on the right.
 */
export function FilterLayout({
  rail,
  railLabel,
  activeCount,
  onClearAll,
  resultLabel,
  toolbar,
  children,
}: {
  rail: ReactNode;
  railLabel: string;
  activeCount: number;
  onClearAll: () => void;
  resultLabel: string;
  toolbar: ReactNode;
  children: ReactNode;
}) {
  const top = useHeaderOffset();
  const [open, setOpen] = useState(false);
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[264px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-12">
      <aside aria-label={railLabel} className="hidden lg:block">
        <div className="sticky -mr-3 overflow-y-auto overscroll-contain pb-8 pr-3" style={{ top: top + 20, maxHeight: `calc(100vh - ${top + 28}px)` }}>
          <div className="mb-5 flex items-center justify-between gap-2">
            <div className="text-[13px] font-semibold text-ink">
              Filters
              {activeCount > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 py-px font-mono text-[10.5px] font-semibold text-accent-ink tnum">{activeCount}</span>}
            </div>
            {activeCount > 0 && (
              <button type="button" onClick={onClearAll} className="text-[12px] text-ink-3 underline decoration-line-2 underline-offset-2 hover:text-ink">
                Reset all
              </button>
            )}
          </div>
          <div className="space-y-4">{rail}</div>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium lg:hidden ${activeCount ? 'border-[color-mix(in_oklab,var(--accent)_55%,transparent)] bg-[var(--accent-soft)] text-ink' : 'border-line bg-surface-2/60 text-ink-2'}`}
          >
            <span aria-hidden>☰</span> Filters{activeCount > 0 && <span className="font-mono tnum">({activeCount})</span>}
          </button>
        </div>
        {children}
      </div>

      <Drawer open={open} onClose={() => setOpen(false)} kicker={railLabel} title="Filters">
        <div className="space-y-4 pb-4">{rail}</div>
        <div className="sticky bottom-0 -mx-6 -mb-5 flex items-center gap-2 border-t border-line bg-surface/95 px-6 py-3 backdrop-blur">
          <button type="button" onClick={onClearAll} disabled={!activeCount} className="rounded-full border border-line px-3 py-1.5 text-[12.5px] text-ink-2 hover:text-ink disabled:opacity-40">
            Clear all
          </button>
          <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-full bg-accent px-4 py-1.5 text-[12.5px] font-semibold text-accent-ink">
            Show {resultLabel}
          </button>
        </div>
      </Drawer>
    </div>
  );
}

/** Honest empty state for a filtered list. */
export function EmptyResults({ noun, onClear, hint = 'Widen the date range or drop a filter.' }: { noun: string; onClear: () => void; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line-2 px-6 py-14 text-center">
      <div className="text-[15px] font-medium text-ink">No {noun} match these filters.</div>
      <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] text-ink-3">{hint}</p>
      <button type="button" onClick={onClear} className="mt-5 rounded-full bg-accent px-4 py-1.5 text-[12.5px] font-semibold text-accent-ink">
        Clear filters
      </button>
    </div>
  );
}

/** Headline numbers for a section: big value, small label underneath. */
export function StatRow({ items }: { items: { value: number | string; label: string; sub?: string; text?: boolean }[] }) {
  return (
    <dl className="flex flex-wrap gap-x-10 gap-y-4">
      {items.map((s) => (
        <div key={s.label} className="flex min-w-0 flex-col-reverse">
          <dt className="mt-1.5 text-[12px] text-ink-3">
            {s.label}
            {s.sub && <span> · {s.sub}</span>}
          </dt>
          <dd className={`font-semibold leading-none tracking-tight text-ink ${s.text ? 'text-[17px] sm:text-[19px]' : 'text-[24px] sm:text-[28px]'}`}>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}
