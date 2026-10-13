import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';
import { registerPlugin } from '@capacitor/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { isNative } from './native';
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

const BackgroundGeolocation = isNative
  ? registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')
  : null;

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

  /**
   * Android only: hand location to a foreground service with a notification, so guidance keeps
   * going with the screen off or another app in front. The browser cannot do this.
   */
  const bgWatcher = useRef<Promise<string> | null>(null);
  const background = useCallback(
    (on: boolean) => {
      if (!BackgroundGeolocation) return;
      if (on && !bgWatcher.current) {
        stop();
        bgWatcher.current = BackgroundGeolocation.addWatcher(
          {
            backgroundTitle: t.navNotifTitle,
            backgroundMessage: t.navNotifText,
            requestPermissions: true,
            stale: false,
            distanceFilter: 0,
          },
          (loc, err) => {
            if (err || !loc) {
              if (err?.code === 'NOT_AUTHORIZED') setStatus('denied');
              return;
            }
            const next: Fix = {
              lng: loc.longitude,
              lat: loc.latitude,
              accuracy: loc.accuracy,
              speed: loc.speed,
              heading: loc.bearing,
              time: loc.time ?? Date.now(),
            };
            setFix(next);
            setStatus('on');
            for (const fn of listeners.current) fn(next);
          },
        );
      } else if (!on && bgWatcher.current) {
        const id = bgWatcher.current;
        bgWatcher.current = null;
        void id.then((watcherId) => BackgroundGeolocation.removeWatcher({ id: watcherId }));
        start();
      }
    },
    [start, stop],
  );

  useEffect(
    () => () => {
      stop();
      const id = bgWatcher.current;
      if (id && BackgroundGeolocation) {
        void id.then((watcherId) => BackgroundGeolocation.removeWatcher({ id: watcherId }));
      }
    },
    [stop],
  );

  return { fix, status, start, subscribe, background };
}
