import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import type * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Theme } from '../core/palette';
import { inTunnel, isNight, TUNNEL_HOLD_MS } from '../core/daylight';
import { isAway } from './native';
import type { Snap } from '../core/nav';
import { MAP_SOURCE } from '../core/style';
import { isNative } from './native';
import { logEvent } from './usageLog';

type Pt = [number, number];

const TUNNEL_READ_MS = 4_000;
/** New tiles are read sooner, but not on every fix: while driving tiles arrive all the time. */
const TUNNEL_NEW_TILES_MS = 1_000;

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
  /** Night or a tunnel at the last fix; `null` before the first. */
  const sun = useRef<boolean | null>(null);
  const shown = useRef<boolean | null>(null);
  const decide = useCallback(() => {
    const next = sun.current;
    if (next !== shown.current) logEvent('theme', { dark: next });
    shown.current = next;
    setDark(next);
  }, []);
  const lastTunnel = useRef(-Infinity);
  /**
   * Tunnels near the user, read from the loaded tiles every few seconds, not on every fix; tiles
   * that arrive meanwhile are read within a second, so the tunnel ahead is never missed.
   */
  const tunnels = useRef<{ at: number; lines: Pt[][]; stale?: boolean }>({
    at: -Infinity,
    lines: [],
  });
  const watched = useRef<maplibregl.Map | null>(null);
  // Each drive decides afresh; the last one's night or tunnel says nothing about this one.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    setDark(null);
  }

  /** New tiles mark the tunnels read as stale; heard only while guiding. */
  const onTiles = useRef((e: maplibregl.MapSourceDataEvent) => {
    if (e.sourceId === MAP_SOURCE && e.tile) tunnels.current.stale = true;
  });
  useEffect(() => {
    if (active) return;
    lastTunnel.current = -Infinity;
    tunnels.current = { at: -Infinity, lines: [] };
    sun.current = null;
    watched.current?.off('sourcedata', onTiles.current);
    watched.current = null;
  }, [active]);

  const update = useCallback(
    (map: maplibregl.Map, s: Snap, time: number) => {
      const [lng, lat] = s.point;
      const night = isNight(lat, lng, time);
      // Dark already, or nobody looking: no tunnel would change anything, so none is read.
      if (night || isAway()) {
        sun.current = night || lastTunnel.current + TUNNEL_HOLD_MS > time;
        decide();
        return;
      }
      if (watched.current !== map) {
        watched.current?.off('sourcedata', onTiles.current);
        watched.current = map;
        map.on('sourcedata', onTiles.current);
      }
      const since = time - tunnels.current.at;
      if (since > TUNNEL_READ_MS || (tunnels.current.stale && since > TUNNEL_NEW_TILES_MS)) {
        tunnels.current = { at: time, lines: tunnelLines(map) };
      }
      if (inTunnel(s.point, s.bearing, tunnels.current.lines)) lastTunnel.current = time;
      // Inside a tunnel GPS often stops altogether: dark holds until a fix outside says otherwise.
      sun.current = lastTunnel.current + TUNNEL_HOLD_MS > time;
      decide();
    },
    [decide],
  );

  /** Night alone, for public transport: no route bearing to match tunnels against. */
  const updateNight = useCallback(
    (p: { lng: number; lat: number }, time: number) => {
      sun.current = isNight(p.lat, p.lng, time);
      decide();
    },
    [decide],
  );

  const theme: Theme | null = active && dark !== null ? (dark ? 'dark' : 'light') : null;
  return { theme, update, updateNight };
}

/** Status bar colours, as in index.html. */
const STATUS_BAR = { light: '#f5f3ef', dark: '#121417' } as const;

/** The phone's status bar follows the navigation theme too, not only the system's. */
export function useStatusBar(navTheme: Theme | null) {
  useEffect(() => {
    // The app: its icons, light on the dark map and dark on the light one. The WebView ignores
    // the theme-color below.
    if (isNative) {
      const style =
        navTheme === 'dark'
          ? SystemBarsStyle.Dark
          : navTheme === 'light'
            ? SystemBarsStyle.Light
            : SystemBarsStyle.Default;
      void SystemBars.setStyle({ style }).catch(() => undefined);
    }
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.dataset.system ??= meta.content;
      meta.content = navTheme ? STATUS_BAR[navTheme] : meta.dataset.system;
    }
  }, [navTheme]);
}
