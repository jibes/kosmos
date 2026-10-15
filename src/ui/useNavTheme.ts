import type * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Theme } from '../core/palette';
import { inTunnel, isNight, TUNNEL_HOLD_MS } from '../core/daylight';
import type { Snap } from '../core/nav';
import { MAP_SOURCE } from '../core/style';

type Pt = [number, number];

/** Road tunnels in the tiles already loaded around the user; asks no server. */
function tunnelLines(map: maplibregl.Map): Pt[][] {
  const features = map.querySourceFeatures(MAP_SOURCE, {
    sourceLayer: 'transportation',
    filter: [
      'all',
      ['==', ['get', 'brunnel'], 'tunnel'],
      ['!', ['in', ['get', 'class'], ['literal', ['rail', 'transit']]]],
    ],
  });
  const lines: Pt[][] = [];
  for (const f of features) {
    const g = f.geometry;
    if (g.type === 'LineString') lines.push(g.coordinates as Pt[]);
    else if (g.type === 'MultiLineString') lines.push(...(g.coordinates as Pt[][]));
  }
  return lines;
}

/**
 * While navigating the theme follows the sun, whatever the system says: light by day, dark
 * after sunset and inside tunnels, so it neither glares at night nor hides the road by day.
 * Fed by the guidance on every fix; `null` until the first fix, when the system decides.
 */
export function useNavTheme(active: boolean) {
  const [dark, setDark] = useState<boolean | null>(null);
  const lastTunnel = useRef(-Infinity);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (active) return;
    lastTunnel.current = -Infinity;
    clearTimeout(timer.current);
  }, [active]);

  const update = useCallback((map: maplibregl.Map, s: Snap, time: number) => {
    const [lng, lat] = s.point;
    const night = isNight(lat, lng, time);
    if (inTunnel(s.point, s.bearing, tunnelLines(map))) lastTunnel.current = time;
    const hold = lastTunnel.current + TUNNEL_HOLD_MS - time;
    setDark(night || hold > 0);
    // Light again when the hold runs out, even if no further fix arrives by then.
    clearTimeout(timer.current);
    if (hold > 0 && !night) timer.current = setTimeout(() => setDark(false), hold);
  }, []);

  /** Night alone, for public transport: no route bearing to match tunnels against. */
  const updateNight = useCallback((p: { lng: number; lat: number }, time: number) => {
    setDark(isNight(p.lat, p.lng, time));
  }, []);

  const theme: Theme | null = active && dark !== null ? (dark ? 'dark' : 'light') : null;
  return { theme, update, updateNight };
}

/** Status bar colours, as in index.html. */
const STATUS_BAR = { light: '#f5f3ef', dark: '#121417' } as const;

/** The phone's status bar follows the navigation theme too, not only the system's. */
export function useStatusBar(navTheme: Theme | null) {
  useEffect(() => {
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.dataset.system ??= meta.content;
      meta.content = navTheme ? STATUS_BAR[navTheme] : meta.dataset.system;
    }
  }, [navTheme]);
}
