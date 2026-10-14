import type * as maplibregl from 'maplibre-gl';
import { useEffect, useRef, type RefObject } from 'react';
import type { LngLat } from '../core/geo';
import { routePadding, wide } from './layout';
import { motion } from './motion';

/**
 * The panel (search, place and route cards): publishes its height as `--panel-h`, so the map
 * buttons sit just above it within the thumb's reach, and keeps a selected place's pin clear of
 * the card describing it, checked once the card has its size (it grows when the details arrive)
 * and the camera has settled.
 */
export function usePanel(
  map: maplibregl.Map | null,
  place: LngLat | null,
  loading: boolean | undefined,
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--panel-h', `${el.offsetHeight}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lng = place?.lng;
  const lat = place?.lat;
  useEffect(() => {
    if (!map || lng === undefined || lat === undefined) return;
    let frame = 0;
    const check = () => {
      if (map.isMoving()) {
        map.once('moveend', check);
        return;
      }
      frame = requestAnimationFrame(() => {
        const panel = ref.current?.getBoundingClientRect();
        if (!panel) return;
        const p = map.project([lng, lat]);
        const covered = wide()
          ? p.x < panel.right + 24 && p.y < panel.bottom + 24
          : p.y > panel.top - 24;
        const off = p.x < 0 || p.y < 0 || p.x > innerWidth || p.y > innerHeight;
        if (covered || off) {
          map.easeTo({ center: [lng, lat], padding: routePadding(), duration: motion(500) });
        }
      });
    };
    frame = requestAnimationFrame(check);
    return () => {
      cancelAnimationFrame(frame);
      map.off('moveend', check);
    };
  }, [map, lng, lat, loading]);

  return ref;
}

/**
 * Location on opening, only where it is already allowed: opening the app never asks. From the
 * globe (first visit) the map flies there; a remembered view stays where it was.
 */
export function useAutoLocate(
  map: maplibregl.Map | null,
  start: () => void,
  flyOnFix: RefObject<boolean>,
) {
  useEffect(() => {
    if (!map || !navigator.permissions) return;
    let live = true;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((p) => {
        if (!live || p.state !== 'granted') return;
        if (map.getZoom() < 4) flyOnFix.current = true;
        start();
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [map, start, flyOnFix]);
}
