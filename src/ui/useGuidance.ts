import type * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { travelHeading } from '../core/compass';
import { distance } from '../core/geo';
import { offRouteLimit, type NavState, type Snap } from '../core/nav';
import type { Mode, Route } from '../core/route';
import { routeRest } from '../core/navView';
import { fitNav, followNav, overviewNav, type NavCamera } from './layout';
import type { userMarker } from './markers';
import { motion } from './motion';
import type { Fix } from './useLocation';
import { useNav } from './useNav';
import type { Voice } from './voice';
import type { Follow } from './Controls';
import type { Adjust } from './useNavView';
import { navZoomFor } from '../core/navView';

/** Off the route by more than this, the way back is shown with the user. */
const OVERVIEW_M = 60;

interface Options {
  map: maplibregl.Map | null;
  meRef: RefObject<ReturnType<typeof userMarker> | null>;
  compass: { current: () => number | null };
  /** Pointers on the map: the app's own camera moves wait while a finger is down. */
  touchingRef: RefObject<Set<number>>;
  /** What the location button set: free, following with the map's own rotation, or heading-up. */
  followRef: RefObject<Follow>;
  /** The camera shows the rest of the route instead of following close behind. */
  overviewRef: RefObject<boolean>;
  /** The user's own zoom and tilt, and whether a pinch or tilt is still to be read. */
  adjustRef: RefObject<Adjust>;
  lookedRef: RefObject<boolean>;
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
  const { map, meRef, compass, touchingRef, followRef, overviewRef, movingRef, updateTheme } = o;
  const { adjustRef, lookedRef } = o;
  const { settled, retry } = o;
  const lastView = useRef<NavCamera | null>(null);
  /** What is left of the route from the user on, for the overview. */
  const rest = useRef<[number, number][]>([]);
  const ways = useRef({ route: o.route, mode: o.mode });
  useEffect(() => {
    ways.current = { route: o.route, mode: o.mode };
  });
  /** The router answer count when a reroute was asked for; `null` when none is pending. */
  const [rerouteAt, setRerouteAt] = useState<number | null>(null);
  // A new drive starts with no reroute pending (state adjusted while rendering, not after).
  const [wasActive, setWasActive] = useState(o.active);
  if (wasActive !== o.active) {
    setWasActive(o.active);
    if (!o.active) setRerouteAt(null);
  }

  /** Heading-up turns the map with the way; else it keeps the rotation the user gave it. */
  const cameraBearing = useCallback(
    (m: maplibregl.Map, heading: number | null) =>
      followRef.current === 'compass' ? heading : m.getBearing(),
    [followRef],
  );
  const follow = useCallback(
    (m: maplibregl.Map, duration: number, bearing?: number) => {
      const v = lastView.current;
      if (!v) return;
      const b = bearing ?? cameraBearing(m, v.bearing);
      followNav(m, { ...v, ...adjustRef.current, bearing: b }, duration);
    },
    [adjustRef, cameraBearing],
  );

  const onStep = useCallback(
    (nav: NavState, f: Fix) => {
      // Too coarse to guide by (network, tunnels): the dot shows it, guidance and camera wait.
      if (nav.weak) {
        meRef.current?.update({ lng: f.lng, lat: f.lat, accuracy: f.accuracy });
        return;
      }
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
      lastView.current = { center, bearing, speed: nav.speed, mode: ways.current.mode };
      const coords = ways.current.route?.coords;
      rest.current = s && coords ? routeRest(coords, s.segment, center) : [center];
      if (!map || touchingRef.current.size) return;
      if (overviewRef.current) {
        fitNav(map, rest.current, motion(1000));
        return;
      }
      if (followRef.current === 'off') return;
      // A pinch or tilt by hand: kept from now on, once the map has come to rest.
      if (lookedRef.current) {
        if (map.isMoving()) return;
        lookedRef.current = false;
        adjustRef.current = {
          zoomBy: map.getZoom() - navZoomFor(lastView.current.mode, nav.speed),
          pitch: map.getPitch(),
        };
      }
      const away = s && !onLine && !nav.arrived ? s.point : null;
      if (away && distance(f, { lng: away[0], lat: away[1] }) > OVERVIEW_M) {
        overviewNav(map, center, away, cameraBearing(map, bearing), motion(1000));
      } else {
        follow(map, motion(1000));
      }
    },
    [
      map,
      compass,
      meRef,
      movingRef,
      touchingRef,
      followRef,
      overviewRef,
      adjustRef,
      lookedRef,
      updateTheme,
      cameraBearing,
      follow,
    ],
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

  /** The camera as the controls now say, at once rather than on the next fix. */
  const recenter = useCallback(
    (bearing?: number) => {
      if (!map) return;
      if (overviewRef.current) fitNav(map, rest.current, motion(600));
      else if (followRef.current !== 'off') follow(map, motion(600), bearing);
    },
    [map, overviewRef, followRef, follow],
  );

  return { nav, tracking: !!tr, rerouteState, recenter } as const;
}
