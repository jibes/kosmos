import type { PluginListenerHandle } from '@capacitor/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { NavLocation } from './native';
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

  // Allowed in the settings after a refusal: pick up without a reload, where the browser tells.
  useEffect(() => {
    if (status !== 'denied' || !navigator.permissions) return;
    let perm: PermissionStatus | null = null;
    let live = true;
    const onChange = () => {
      if (perm?.state === 'granted') start();
    };
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((p) => {
        if (!live) return;
        perm = p;
        p.addEventListener('change', onChange);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      perm?.removeEventListener('change', onChange);
    };
  }, [status, start]);

  /**
   * Android only: hand location to the app's foreground service, so guidance keeps going with
   * the screen off or another app in front. The browser cannot do this. The WebView's own watch
   * carries on until the service delivers its first fix, so a service that cannot start (no
   * permission, refused) never leaves guidance without positions while the app is open.
   */
  const native = useRef<{ on: boolean; handle: PluginListenerHandle | null }>({
    on: false,
    handle: null,
  });
  const background = useCallback(
    /** `onApproximate`: the service runs on approximate location only, which guidance can't use. */
    (on: boolean, onApproximate?: () => void) => {
      const plugin = NavLocation;
      if (!plugin) return;
      const bg = native.current;
      if (on && !bg.on) {
        bg.on = true;
        let first = true;
        void plugin
          .addListener('location', (loc) => {
            if (!bg.on) return;
            if (first) {
              first = false;
              stop();
            }
            const next: Fix = {
              lng: loc.lng,
              lat: loc.lat,
              accuracy: loc.accuracy,
              speed: loc.speed ?? null,
              heading: loc.bearing ?? null,
              time: loc.time,
            };
            setFix(next);
            setStatus('on');
            for (const fn of listeners.current) fn(next);
          })
          .then((handle) => {
            if (bg.on) bg.handle = handle;
            else void handle.remove();
          });
        // The plugin's question is the only one: the WebView's own watch starts once it is
        // answered (two prompts at once cancel each other), until the service's first fix.
        plugin
          .start({ title: t.navNotifTitle, text: t.navNotifText })
          .then((r) => {
            if (r?.approximate) onApproximate?.();
            if (bg.on && first) start();
          })
          .catch((e: unknown) => {
            const code = (e as { code?: string } | null)?.code;
            if (code === 'NOT_AUTHORIZED') setStatus('denied');
            else if (bg.on) start();
          });
      } else if (!on && bg.on) {
        bg.on = false;
        void bg.handle?.remove();
        bg.handle = null;
        void plugin.stop();
        start();
      }
    },
    [start, stop],
  );

  useEffect(
    () => () => {
      stop();
      if (native.current.on) {
        native.current.on = false;
        void native.current.handle?.remove();
        void NavLocation?.stop();
      }
    },
    [stop],
  );

  return { fix, status, start, subscribe, background };
}
