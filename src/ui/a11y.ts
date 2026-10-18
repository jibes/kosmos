import { useEffect, useRef, type KeyboardEvent } from 'react';

/**
 * Moves focus to an element when it appears (a card's heading), so keyboard and screen-reader
 * users land where the content is instead of on the page itself. No scrolling: the card is
 * already where it should be.
 */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}

/**
 * After a card closes from the keyboard, the search field is where to go on. At once where it
 * is shown (in a tap, so a phone opens its keyboard); still hidden behind the closing card, once
 * the card is gone.
 */
export function focusSearch() {
  const go = () => {
    const input = document.querySelector<HTMLInputElement>('.bar input');
    input?.focus({ preventScroll: true });
    return !!input && document.activeElement === input;
  };
  if (!go()) requestAnimationFrame(() => void go());
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Arrow keys (and Home, End) move through a radio group and choose, as for native radios; the
 * group is one Tab stop (`tabIndex` 0 on the checked radio only).
 */
export function arrowRadios(e: KeyboardEvent<HTMLElement>) {
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=radio]')];
  const at = radios.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  const next =
    e.key in STEP
      ? (at + STEP[e.key] + radios.length) % radios.length
      : e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? radios.length - 1
          : -1;
  if (next < 0) return;
  e.preventDefault();
  radios[next].focus();
  radios[next].click();
}
