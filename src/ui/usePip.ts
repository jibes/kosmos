import { useEffect } from 'react';
import { allowPip, keepRunning } from './native';
import { logEvent } from './usageLog';

/** Set on `<html>` while the app is a small window over others: only the turn and the map. */
export const PIP_ATTR = 'data-pip';
export const inPip = () => document.documentElement.hasAttribute(PIP_ATTR);

/**
 * Picture-in-picture (Android), and the page kept running out of sight: while guiding, leaving the app (Home, another app) shrinks it
 * to a small window instead of hiding it (`MainActivity`); the page then lays itself out small
 * (`data-pip`, `styles/navigation.css`) until it is full size again.
 */
export function usePip(guiding: boolean) {
  useEffect(() => {
    allowPip?.(guiding);
    // Out of sight the page keeps running, so turns are still said (`KosmosWebView`).
    keepRunning?.(guiding);
  }, [guiding]);
  useEffect(() => {
    // `MainActivity` says so with an event of its own (Capacitor's `triggerWindowJSEvent`).
    const on = (e: Event) => {
      const small = !!(e as Event & { on?: boolean }).on;
      document.documentElement.toggleAttribute(PIP_ATTR, small);
      // The map fills its new size at once.
      window.dispatchEvent(new Event('resize'));
      logEvent('nav.pip', { on: small });
    };
    window.addEventListener('kosmospip', on);
    return () => window.removeEventListener('kosmospip', on);
  }, []);
}
