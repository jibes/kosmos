import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterHeading, headingOf, norm, type HeadingFilter } from '../core/compass';
import type { LngLat } from '../core/geo';
import { decimalYear, declination } from '../core/magnetic';

type Listener = (heading: number) => void;

interface IOSOrientationEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/**
 * The device compass, smoothed, to true north. Headings stream to subscribers (60 Hz is too fast
 * for React state); `available` flips once, when the first north-anchored reading arrives.
 * Phones read magnetic north; the map is drawn to true north, so each reading adds the
 * declination where the user is (`where`, kept to a tenth of a degree; none before a fix).
 */
export function useCompass(where: LngLat | null) {
  const lat = where ? Math.round(where.lat * 10) / 10 : null;
  const lng = where ? Math.round(where.lng * 10) / 10 : null;
  const offset = useRef(0);
  const heading = useRef<number | null>(null);
  const filter = useRef<HeadingFilter | null>(null);
  const listeners = useRef(new Set<Listener>());
  useEffect(() => {
    const next =
      lat === null || lng === null ? 0 : declination({ lng, lat }, decimalYear(Date.now()));
    const shift = next - offset.current;
    offset.current = next;
    // The first fix (or a long way travelled) turns the heading shown at once, not only with
    // the next reading: a phone lying still may send few.
    if (!filter.current || !shift) return;
    filter.current = { ...filter.current, heading: norm(filter.current.heading + shift) };
    heading.current = filter.current.heading;
    for (const fn of listeners.current) fn(heading.current);
  }, [lat, lng]);
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
      const north = norm(h + offset.current);
      if (heading.current == null) setAvailable(true);
      filter.current = filterHeading(filter.current, north, e.timeStamp || performance.now());
      heading.current = filter.current.heading;
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
