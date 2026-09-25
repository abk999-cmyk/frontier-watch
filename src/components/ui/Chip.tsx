import type { ReactNode } from 'react';

/** Toggle chip; `color` renders a leading identity glyph (never colours the text). */
export function Chip({
  active,
  onClick,
  color,
  glyph,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  glyph?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-all ${
        active ? 'border-line-2 bg-surface-3 text-ink' : 'border-line bg-transparent text-ink-3 hover:text-ink-2'
      }`}
    >
      {color && (
        <span className="text-[10px] leading-none transition-opacity" style={{ color, opacity: active ? 1 : 0.35 }}>
          {glyph ?? '●'}
        </span>
      )}
      {children}
    </button>
  );
}
