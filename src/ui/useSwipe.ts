import { useEffect, useRef, type RefObject } from 'react';

/** A finger has to move this far, mostly up or down, before the panel is being dragged. */
const SLOP_PX = 8;

/** What a drag that starts now may do: which way it pulls (down 1, up -1), or nothing. */
export interface SwipeRule {
  /** The direction that moves the panel; the other way only follows reluctantly. */
  dir: 1 | -1;
  /**
   * The content scrolls first: a drag counts only once the list under the finger is at its
   * end in the drag's direction (scrolled to the top for a pull down).
   */
  scrollFirst: boolean;
}

/** The scrolling element under a touch, within the panel (the panel itself counts). */
function scrollerOf(target: Element | null, root: HTMLElement): HTMLElement | null {
  for (let el = target; el && root.contains(el); el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue;
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1)
      return el;
    if (el === root) break;
  }
  return null;
}

/** At its end in the direction of a pull: a pull down needs the top, a pull up the bottom. */
const atEnd = (el: HTMLElement | null, dir: 1 | -1) =>
  !el || (dir > 0 ? el.scrollTop <= 0 : el.scrollTop + el.clientHeight >= el.scrollHeight - 1);

/**
 * Touch drags anywhere on a panel, not only on its grab bar: a tap stays a tap (rows, stops,
 * buttons), a sideways move stays with what is under it (tabs, sliders), text fields are
 * left alone, and a list scrolls until it is at its end. `rule` is read as each drag starts;
 * `onMove` follows the finger (pixels, down positive), `onEnd` says where it let go and how
 * fast (pixels per millisecond).
 */
export function useSwipe(
  ref: RefObject<HTMLElement | null>,
  rule: () => SwipeRule | null,
  onMove: (dy: number) => void,
  onEnd: (dy: number, speed: number) => void,
) {
  const handlers = useRef({ rule, onMove, onEnd });
  useEffect(() => {
    handlers.current = { rule, onMove, onEnd };
  });

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let start: { x: number; y: number; t: number; target: Element | null } | null = null;
    /** Undecided, the panel's drag, or someone else's gesture. */
    let mode: 'wait' | 'drag' | 'other' = 'wait';
    let last = 0;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        start = null;
        return;
      }
      const touch = e.touches[0];
      start = { x: touch.clientX, y: touch.clientY, t: e.timeStamp, target: e.target as Element };
      mode = 'wait';
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!start || mode === 'other') return;
      const touch = e.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (mode === 'wait') {
        if (Math.hypot(dx, dy) < SLOP_PX) return;
        const r = handlers.current.rule();
        const vertical = Math.abs(dy) > Math.abs(dx);
        const field = start.target?.closest('input, textarea, select, [data-no-swipe]');
        const along = r && Math.sign(dy) === r.dir;
        const free =
          r && (!r.scrollFirst || !along || atEnd(scrollerOf(start.target, root), r.dir));
        // Against the pull on a list that scrolls, the list has it.
        const scrolls = r?.scrollFirst && !along && scrollerOf(start.target, root);
        mode = r && vertical && !field && free && !scrolls ? 'drag' : 'other';
        if (mode === 'other') return;
      }
      e.preventDefault();
      last = dy;
      handlers.current.onMove(dy);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (start && mode === 'drag') {
        handlers.current.onEnd(last, last / Math.max(1, e.timeStamp - start.t));
      }
      start = null;
      mode = 'wait';
      last = 0;
    };
    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    root.addEventListener('touchend', onTouchEnd);
    root.addEventListener('touchcancel', onTouchEnd);
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [ref]);
}
