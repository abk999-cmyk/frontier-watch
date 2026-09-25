import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  onClose: () => void;
  anchor: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: 'start' | 'end';
  width?: number;
}

/**
 * Floating panel anchored to a trigger. Portalled to <body> so it escapes
 * overflow/transform containers; flips above the trigger when there's no room
 * below; closes on outside press and Esc; follows scroll/resize.
 */
export function Popover({ open, onClose, anchor, children, align = 'start', width = 300 }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean; maxH: number } | null>(null);

  const place = useCallback(() => {
    const a = anchor.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(width, vw - 16);
    let left = align === 'start' ? r.left : r.right - w;
    left = Math.max(8, Math.min(left, vw - w - 8));
    const below = vh - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 320 && above > below;
    setPos({ left, top: up ? r.top - 6 : r.bottom + 6, up, maxH: Math.max(200, (up ? above : below) - 8) });
  }, [anchor, align, width]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onMove = () => place();
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, onClose, anchor, place]);

  return createPortal(
    <AnimatePresence>
      {open && pos && (
        <motion.div
          ref={panel}
          role="dialog"
          initial={{ opacity: 0, y: pos.up ? 6 : -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: pos.up ? 6 : -6, scale: 0.98 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
          className="fixed z-[60] overflow-y-auto rounded-2xl border border-line-2 bg-surface-2/95 p-3 text-[12.5px] text-ink shadow-[0_24px_60px_-20px_rgba(0,0,0,.6)] backdrop-blur-xl"
          style={{ left: pos.left, top: pos.top, width: Math.min(width, window.innerWidth - 16), maxHeight: pos.maxH, translate: pos.up ? '0 -100%' : undefined }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
