import type * as maplibregl from 'maplibre-gl';
import { useCallback, useRef, useState, type RefObject } from 'react';
import { travelHeading } from '../core/compass';
import { distance } from '../core/geo';
import { offRouteLimit, type NavState, type Snap } from '../core/nav';
import type { Mode, Route } from '../core/route';
import { followNav, overviewNav, type NavCamera } from './layout';
import type { userMarker } from './markers';
import { motion } from './motion';
import type { Fix } from './useLocation';
import { useNav } from './useNav';
import type { Voice } from './voice';

/** Off the route by more than this, the way back is shown with the user. */
const OVERVIEW_M = 60;

interface Options {
  map: maplibregl.Map | null;
  meRef: RefObject<ReturnType<typeof userMarker> | null>;
  compass: { current: () => number | null };
  /** Pointers on the map: the app's own camera moves wait while a finger is down. */
  touchingRef: RefObject<Set<number>>;
  /** The camera follows (the user has not looked around since). */
  followingRef: RefObject<boolean>;
  /** Set on every fix: moving fast enough for the route's direction to be the heading. */
  movingRef: RefObject<boolean>;
  updateTheme: (map: maplibregl.Map, s: Snap, time: number) => void;
  route: Route | undefined;
  mode: Mode;
  active: boolean;
  subscribe: (fn: (fix: Fix) => void) => () => void;
  /** The latest fix, counted at once when guidance starts. */
  last: Fix | null;
  voice: Voice;
  muted: boolean;
  /** The router's answers so far, whether the last one was kept, and asking again. */
  settled: number;
  kept: boolean;
  retry: () => void;
}

/** Road guidance on the map: the arrow, the camera behind the user, and rerouting. */
export function useGuidance(o: Options) {
  const { map, meRef, compass, touchingRef, followingRef, movingRef, updateTheme } = o;
  const { settled, retry } = o;
  const lastView = useRef<NavCamera | null>(null);
  /** The router answer count when a reroute was asked for; `null` when none is pending. */
  const [rerouteAt, setRerouteAt] = useState<number | null>(null);
  // A new drive starts with no reroute pending (state adjusted while rendering, not after).
  const [wasActive, setWasActive] = useState(o.active);
  if (wasActive !== o.active) {
    setWasActive(o.active);
    if (!o.active) setRerouteAt(null);
  }

  const onStep = useCallback(
    (nav: NavState, f: Fix) => {
      const s = nav.snap;
      // On the line the arrow rides the route; off it (or after arriving) it is where the fix
      // is, and so is the camera: a missed turn must not leave the user off the screen.
      const onLine = !!s && !nav.arrived && s.offset < offRouteLimit(f.accuracy);
      const center: [number, number] = onLine ? s.point : [f.lng, f.lat];
      const course = nav.moving && f.heading != null && !Number.isNaN(f.heading) ? f.heading : null;
      const bearing = onLine
        ? travelHeading(s.bearing, compass.current(), nav.moving)
        : (course ?? compass.current());
      meRef.current?.update({ lng: center[0], lat: center[1], accuracy: f.accuracy });
      movingRef.current = nav.moving;
      meRef.current?.heading(bearing);
      if (s && map) updateTheme(map, s, nav.time);
      lastView.current = { center, bearing, speed: nav.speed };
      if (!map || !followingRef.current || touchingRef.current.size) return;
      const away = s && !onLine && !nav.arrived ? s.point : null;
      if (away && distance(f, { lng: away[0], lat: away[1] }) > OVERVIEW_M) {
        overviewNav(map, center, away, bearing, motion(1000));
      } else {
        followNav(map, lastView.current, motion(1000));
      }
    },
    [map, compass, meRef, movingRef, touchingRef, followingRef, updateTheme],
  );

  // The route being followed stays until a new one comes, and a failed request keeps it.
  const reroute = useCallback(() => {
    setRerouteAt(settled);
    retry();
  }, [settled, retry]);

  const { nav, tr } = useNav({
    route: o.route,
    mode: o.mode,
    active: o.active,
    subscribe: o.subscribe,
    last: o.last,
    voice: o.voice,
    muted: o.muted,
    onStep,
    onReroute: reroute,
  });

  const rerouteState =
    rerouteAt === null || (settled !== rerouteAt && !o.kept)
      ? 'idle'
      : settled === rerouteAt
        ? 'asking'
        : 'failed';

  const recenter = useCallback(() => {
    if (map && lastView.current) followNav(map, lastView.current, motion(600));
  }, [map]);

  return { nav, tracking: !!tr, rerouteState, recenter } as const;
}
