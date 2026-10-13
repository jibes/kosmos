import { useCallback, useEffect, useRef, useState } from 'react';
import type { LngLat } from '../core/geo';

export interface Fix extends LngLat {
  /** Radius in metres. */
  accuracy: number;
  /** m/s, if the device reports it. */
  speed: number | null;
  /** Degrees clockwise from north, if moving. */
  heading: number | null;
  /** ms since epoch. */
  time: number;
}

export type LocationStatus = 'off' | 'seeking' | 'on' | 'denied' | 'unavailable';

export function useLocation() {
  const [fix, setFix] = useState<Fix | null>(null);
  const [status, setStatus] = useState<LocationStatus>('off');
  const watch = useRef<number | null>(null);
  const listeners = useRef(new Set<(fix: Fix) => void>());

  /** Every fix as it arrives, for consumers that must not miss one (navigation). */
  const subscribe = useCallback((fn: (fix: Fix) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const stop = useCallback(() => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
  }, []);

  const start = useCallback(() => {
    if (watch.current !== null) return;
    if (!('geolocation' in navigator)) {
      setStatus('unavailable');
      return;
    }
    setStatus('seeking');
    watch.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const next: Fix = {
          lng: coords.longitude,
          lat: coords.latitude,
          accuracy: coords.accuracy,
          speed: coords.speed,
          heading: coords.heading,
          time: Date.now(),
        };
        setFix(next);
        for (const fn of listeners.current) fn(next);
        setStatus('on');
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          stop();
          setStatus('denied');
        } else {
          setStatus((s) => (s === 'on' ? s : 'unavailable'));
        }
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 },
    );
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { fix, status, start, subscribe };
}
