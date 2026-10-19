import type * as maplibregl from 'maplibre-gl';
import { useEffect, useRef, type RefObject } from 'react';
import { roadModeOf } from '../core/route';
import type { Follow } from './Controls';
import { followNav } from './layout';
import type { userMarker } from './markers';
import { motion } from './motion';
import type { useCompass } from './useCompass';
import type { Fix } from './useLocation';
import type { Trip } from './useRoute';
import { ASKED } from './useCategory';

interface Refs {
  me: RefObject<ReturnType<typeof userMarker> | null>;
  compass: ReturnType<typeof useCompass>;
  followRef: RefObject<Follow>;
  /** Fingers on the map: the camera waits for them. */
  touching: RefObject<Set<number>>;
  tripRef: RefObject<Trip | null>;
  navRef: RefObject<boolean>;
  roadNavRef: RefObject<boolean>;
  /** Road guidance has its route and moves the arrow and the camera itself. */
  trackingRef: RefObject<boolean>;
  /** The location button asked for the first fix: fly there when it comes. */
  flyOnFix: RefObject<boolean>;
}

/**
 * Within `px` of the middle of the view: GPS jitter while standing, not worth a camera move
 * (each one a second of full renders).
 */
export function nearCentre(map: maplibregl.Map, p: { lng: number; lat: number }, px = 2) {
  const a = map.project([p.lng, p.lat]);
  const c = map.project(map.getCenter());
  return Math.hypot(a.x - c.x, a.y - c.y) < px;
}

/**
 * Each fix on the map: the user's dot, and the camera as the location button says. Guidance
 * with a route and the ride's camera take over from it.
 */
export function useFixCamera(map: maplibregl.Map | null, fix: Fix | null, refs: Refs) {
  const { compass, followRef, tripRef, navRef, roadNavRef, trackingRef } = refs;
  const { me: meRef, touching: touchingRef, flyOnFix: flyOnFixRef } = refs;
  /** The newest fix, and whether a catch-up waits for the camera to stop. */
  const latestFixRef = useRef(fix);
  const catchingUpRef = useRef(false);
  useEffect(() => {
    latestFixRef.current = fix;
    if (!map || !fix || (roadNavRef.current && trackingRef.current)) return;
    meRef.current?.update(fix);
    if (roadNavRef.current) {
      // Guidance is still waiting for its route: the dot and the camera follow the fix meanwhile.
      const heading = fix.heading != null && (fix.speed ?? 0) > 2 ? fix.heading : compass.current();
      if (followRef.current !== 'off' && !touchingRef.current.size) {
        followNav(
          map,
          {
            center: [fix.lng, fix.lat],
            bearing: followRef.current === 'compass' ? heading : map.getBearing(),
            speed: fix.speed ?? 0,
            mode: roadModeOf(tripRef.current),
          },
          motion(1000),
        );
      }
      return;
    }
    // On public transport the ride's own camera follows (`useRideCamera`).
    if (navRef.current) return;
    // A finger on the map: this fix moves the dot only; the next one catches the camera up.
    if (touchingRef.current.size) return;
    if (flyOnFixRef.current) {
      flyOnFixRef.current = false;
      // Asked for by the location button: the search's results may now be elsewhere.
      map.flyTo(
        { center: [fix.lng, fix.lat], zoom: Math.max(map.getZoom(), 15), duration: motion(1800) },
        ASKED,
      );
    } else if (followRef.current === 'position') {
      // Never cut short a running camera move (the fly-in after tapping locate would stop at
      // globe zoom); catch up when it ends, to the newest fix, since underground no further
      // fix may come.
      const follow = () => {
        const f = latestFixRef.current;
        if (f && !nearCentre(map, f)) map.easeTo({ center: [f.lng, f.lat], duration: motion(800) });
      };
      if (!map.isMoving()) follow();
      else if (!catchingUpRef.current) {
        catchingUpRef.current = true;
        map.once('moveend', () => {
          catchingUpRef.current = false;
          if (followRef.current === 'position' && !map.isMoving()) follow();
        });
      }
    } else if (followRef.current === 'compass') {
      // The compass turns the map every frame; an ease here would fight it, so the centre jumps.
      if (!map.isMoving() && !nearCentre(map, fix)) map.jumpTo({ center: [fix.lng, fix.lat] });
    }
  }, [
    map,
    fix,
    compass,
    meRef,
    followRef,
    touchingRef,
    tripRef,
    navRef,
    roadNavRef,
    trackingRef,
    flyOnFixRef,
  ]);
}
