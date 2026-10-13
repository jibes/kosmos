import { useCallback, useEffect, useRef, useState } from 'react';
import type { LngLat } from '../core/geo';

export interface Fix extends LngLat {
  /** Radius in metres. */
  accuracy: number;
}

export type LocationStatus = 'off' | 'seeking' | 'on' | 'denied' | 'unavailable';

export function useLocation() {
  const [fix, setFix] = useState<Fix | null>(null);
  const [status, setStatus] = useState<LocationStatus>('off');
  const watch = useRef<number | null>(null);

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
        setFix({ lng: coords.longitude, lat: coords.latitude, accuracy: coords.accuracy });
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
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { fix, status, start };
}
