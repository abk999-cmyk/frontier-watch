import { motion } from 'motion/react';
import { useId, type ReactNode } from 'react';

interface Option<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

/** Pill segmented control with an animated sliding thumb. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  label,
}: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  label?: string;
}) {
  const id = useId();
  const pad = size === 'md' ? 'px-3.5 py-1.5 text-[13px]' : 'px-2.5 py-1 text-[12px]';
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full items-center overflow-x-auto rounded-full border border-line bg-surface-2/70 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`relative whitespace-nowrap rounded-full font-medium transition-colors ${pad} ${active ? 'text-accent-ink' : 'text-ink-2 hover:text-ink'}`}
          >
            {active && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-full bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
