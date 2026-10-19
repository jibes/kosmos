import type * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { travelHeading } from '../core/compass';
import { distance } from '../core/geo';
import { offRouteLimit, track, type NavState, type Snap } from '../core/nav';
import { turnOf, type Mode, type Route } from '../core/route';
import { routeRest } from '../core/navView';
import { createGlide } from './glide';
import {
  fitNav,
  followCamera,
  followNav,
  followTakes,
  overviewNav,
  type NavCamera,
} from './layout';
import type { userMarker } from './markers';
import { motion } from './motion';
import type { Fix } from './useLocation';
import { useNav } from './useNav';
import type { Voice } from './voice';
import { logEvent } from './usageLog';
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
  const autoRef = useRef(false);
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

  /** The arrow and the follow camera between fixes (`glide.ts`). */
  const glide = useMemo(() => (map ? createGlide(map) : null), [map]);
  /** The route as guidance measures it, for the arrow to glide along. */
  const line = useMemo(() => (o.route ? track(o.route, o.mode) : null), [o.route, o.mode]);
  const lastFix = useRef(0);
  useEffect(() => {
    if (!o.active) glide?.reset();
  }, [o.active, glide]);
  useEffect(() => () => glide?.stop(), [glide]);

  const onStep = useCallback(
    (nav: NavState, f: Fix) => {
      // Too coarse to guide by (network, tunnels): the dot shows it, guidance and camera wait.
      if (nav.weak) {
        glide?.reset();
        meRef.current?.update({ lng: f.lng, lat: f.lat, accuracy: f.accuracy });
        return;
      }
      const s = nav.snap;
      // On the line the arrow rides the route; off it (or after arriving) it is where the fix
      // is, and so is the camera: a missed turn must not leave the user off the screen.
      const onLine = !!s && !nav.arrived && s.offset < offRouteLimit(f.accuracy, ways.current.mode);
      const center: [number, number] = onLine ? s.point : [f.lng, f.lat];
      const course = nav.moving && f.heading != null && !Number.isNaN(f.heading) ? f.heading : null;
      const bearing = onLine
        ? travelHeading(s.bearing, compass.current(), nav.moving)
        : (course ?? compass.current());
      movingRef.current = nav.moving;
      meRef.current?.heading(bearing);
      if (s && map) updateTheme(map, s, nav.time);
      // Closer in as a turn comes (not for going straight on or setting off).
      const m = ways.current.route?.maneuvers[nav.next];
      const turn = !!m && onLine && !['straight', 'depart'].includes(turnOf(m.type));
      lastView.current = {
        center,
        bearing,
        speed: nav.speed,
        mode: ways.current.mode,
        toTurn: turn ? nav.toNext : Infinity,
      };
      const coords = ways.current.route?.coords;
      rest.current = s && coords ? routeRest(coords, s.segment, center) : [center];

      // About the time to the next fix, so the arrow is never still and never jumps.
      const gap = lastFix.current ? f.time - lastFix.current : 1000;
      lastFix.current = f.time;
      const ms = motion(Math.max(300, Math.min(1500, gap)));
      const glideTo = (cam: ReturnType<typeof followCamera> | null) =>
        glide?.to(
          { point: center, along: onLine ? s.along : null },
          ms,
          line,
          cam,
          (p) => meRef.current?.update({ lng: p[0], lat: p[1], accuracy: f.accuracy }),
          () => !touchingRef.current.size && !lookedRef.current && !overviewRef.current,
        );

      if (!map || touchingRef.current.size || followRef.current === 'off') return glideTo(null);
      if (overviewRef.current) {
        glideTo(null);
        fitNav(map, rest.current, motion(1000));
        return;
      }
      // A pinch or tilt by hand: kept from now on, once the map has come to rest.
      if (lookedRef.current) {
        if (map.isMoving()) return glideTo(null);
        lookedRef.current = false;
        adjustRef.current = {
          zoomBy:
            map.getZoom() - navZoomFor(lastView.current.mode, nav.speed, lastView.current.toTurn),
          pitch: map.getPitch(),
        };
      }
      const away = s && !onLine && !nav.arrived ? s.point : null;
      const far = !!away && distance(f, { lng: away[0], lat: away[1] }) > OVERVIEW_M;
      // The usage log: how often the camera takes in the way back by itself.
      if (far !== autoRef.current) logEvent('nav.autoOverview', { on: far });
      autoRef.current = far;
      if (away && far) {
        glideTo(null);
        overviewNav(map, center, away, cameraBearing(map, bearing), motion(1000));
        return;
      }
      followTakes(map);
      glideTo(
        followCamera(map, {
          ...lastView.current,
          ...adjustRef.current,
          bearing: cameraBearing(map, bearing),
        }),
      );
    },
    [
      map,
      glide,
      line,
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
      glide?.release();
      if (overviewRef.current) fitNav(map, rest.current, motion(600));
      else if (followRef.current !== 'off') follow(map, motion(600), bearing);
    },
    [map, glide, overviewRef, followRef, follow],
  );

  return { nav, tracking: !!tr, rerouteState, recenter } as const;
}
