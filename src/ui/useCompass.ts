import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { headingOf, smoothHeading } from '../core/compass';

type Listener = (heading: number) => void;

interface IOSOrientationEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/**
 * The device compass, smoothed. Headings stream to subscribers (60 Hz is too fast for React
 * state); `available` flips once, when the first north-anchored reading arrives.
 */
export function useCompass() {
  const heading = useRef<number | null>(null);
  const listeners = useRef(new Set<Listener>());
  const [available, setAvailable] = useState(false);
  const stop = useRef<(() => void) | null>(null);

  /** Call from a tap: iOS only grants orientation access inside a user gesture. */
  const start = useCallback(async () => {
    if (stop.current || typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      return;
    }
    // iOS (and newer Chromium) gate sensors behind requestPermission. A refusal only means no
    // events will arrive, so listen regardless rather than giving up on browsers that answer
    // "denied" without asking.
    const D = window.DeviceOrientationEvent as unknown as IOSOrientationEvent;
    if (D.requestPermission) await D.requestPermission().catch(() => 'denied');
    const onEvent = (e: Event) => {
      const o = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
      const h = headingOf(
        {
          alpha: o.alpha,
          beta: o.beta,
          gamma: o.gamma,
          absolute: o.absolute || e.type === 'deviceorientationabsolute',
          webkitCompassHeading: o.webkitCompassHeading,
        },
        screen.orientation?.angle ?? 0,
      );
      if (h == null) return;
      if (heading.current == null) setAvailable(true);
      heading.current = smoothHeading(heading.current, h);
      for (const fn of listeners.current) fn(heading.current);
    };
    // Chromium sends north-anchored readings as deviceorientationabsolute, Safari and some
    // browsers as deviceorientation (absolute or with webkitCompassHeading). Listen to both;
    // headingOf drops relative readings, so a wrong north never gets in.
    const types = ['deviceorientationabsolute', 'deviceorientation'];
    for (const type of types) window.addEventListener(type, onEvent);
    stop.current = () => {
      for (const type of types) window.removeEventListener(type, onEvent);
    };
  }, []);

  useEffect(() => () => stop.current?.(), []);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const current = useCallback(() => heading.current, []);

  return useMemo(
    () => ({ start, subscribe, current, available }),
    [start, subscribe, current, available],
  );
}
