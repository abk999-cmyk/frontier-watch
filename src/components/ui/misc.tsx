import { AnimatePresence, motion } from 'motion/react';
import { Component, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Stat({ label, value, sub, className = '' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="kicker mb-1.5">{label}</div>
      <div className="text-[26px] font-semibold leading-none tracking-tight text-ink">{value}</div>
      {sub && <div className="mt-1.5 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-ink-3">{sub}</div>}
    </div>
  );
}

/** Right-hand slide-over for detail views (model, ASI item, milestone). Esc closes. */
export function Drawer({ open, onClose, title, kicker, children }: { open: boolean; onClose: () => void; title?: ReactNode; kicker?: ReactNode; children?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  // Portal to <body> so an ancestor transform/filter can never capture position: fixed.
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[540px] flex-col border-l border-line-2 bg-surface/95 shadow-2xl backdrop-blur-xl"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 40 }}
          >
            <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div className="min-w-0">
                {kicker && <div className="kicker mb-1">{kicker}</div>}
                <div className="text-lg font-semibold tracking-tight">{title}</div>
              </div>
              <button onClick={onClose} aria-label="Close" className="rounded-full border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:text-ink">
                Esc
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Hover/focus explainer. Enhances; never the only way to read a value. */
export function InfoTip({ children, label = 'i', className = '', align = 'center' }: { children: ReactNode; label?: ReactNode; className?: string; align?: 'center' | 'left' | 'right' }) {
  const pos = align === 'left' ? 'left-0' : align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2';
  return (
    <span className={`group relative inline-flex align-middle ${className}`}>
      <button type="button" className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-line-2 px-1 font-mono text-[9.5px] text-ink-3 hover:text-ink">
        {label}
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-30 mt-2 hidden w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-line-2 bg-surface-2 p-3 text-left text-[12px] font-normal normal-case leading-relaxed tracking-normal text-ink-2 shadow-xl group-focus-within:block group-hover:block ${pos}`}
      >
        {children}
      </span>
    </span>
  );
}

export function Skeleton({ h = 320, className = '' }: { h?: number; className?: string }) {
  return <div className={`shimmer rounded-[18px] border border-line ${className}`} style={{ height: h }} />;
}

export function TabSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <Skeleton h={420} className="lg:col-span-2" />
      <Skeleton h={420} />
      <Skeleton h={280} className="lg:col-span-3" />
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel p-6">
        <div className="kicker mb-2" style={{ color: 'var(--critical)' }}>
          {this.props.label ?? 'Module'} failed to render
        </div>
        <p className="text-sm text-ink-2">{this.state.error.message}</p>
        <button className="mt-3 rounded-full border border-line-2 px-3 py-1 text-[12px]" onClick={() => this.setState({ error: null })}>
          Retry
        </button>
      </div>
    );
  }
}

/** Small legend row: glyph + label per series (identity never by colour alone). */
export function Legend({ items }: { items: { label: string; color: string; glyph?: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.dashed ? (
            <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: i.color }} />
          ) : (
            <span className="text-[11px] leading-none" style={{ color: i.color }}>
              {i.glyph ?? '●'}
            </span>
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}
