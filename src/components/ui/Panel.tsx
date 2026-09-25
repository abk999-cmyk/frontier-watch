import { useRef, type PointerEvent, type ReactNode } from 'react';

interface PanelProps {
  title?: ReactNode;
  kicker?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}

/** Glass card with a pointer-following spotlight border. The standard container for every module. */
export function Panel({ title, kicker, actions, footer, children, className = '', bodyClassName = '', id }: PanelProps) {
  const ref = useRef<HTMLElement>(null);
  const onMove = (e: PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  return (
    <section ref={ref} id={id} onPointerMove={onMove} className={`panel ${className}`}>
      {(title || kicker || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            {kicker && <div className="kicker mb-1">{kicker}</div>}
            {title && <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`px-5 pb-5 pt-3 sm:px-6 ${bodyClassName}`}>{children}</div>
      {footer && <footer className="border-t border-line px-5 py-3 text-[11.5px] text-ink-3 sm:px-6">{footer}</footer>}
    </section>
  );
}
