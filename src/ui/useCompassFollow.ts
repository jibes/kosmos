import type * as maplibregl from 'maplibre-gl';
import { useEffect, type RefObject } from 'react';
import type { Follow } from './Controls';
import type { userMarker } from './markers';
import type { useCompass } from './useCompass';

interface Refs {
  me: RefObject<ReturnType<typeof userMarker> | null>;
  /** Road guidance owns the arrow: the compass only turns it while slow or standing. */
  roadNavRef: RefObject<boolean>;
  navMovingRef: RefObject<boolean>;
  followRef: RefObject<Follow>;
  /** Fingers on the map: the camera waits for them. */
  touching: RefObject<Set<number>>;
  setFollow: (f: Follow) => void;
}

/**
 * The compass on the map: the beam on the user's dot always, and in compass mode the map
 * turning with the phone, never fighting another camera move or a finger. Turning the map by
 * hand leaves compass mode and keeps following the position.
 */
export function useCompassFollow(
  map: maplibregl.Map | null,
  compass: ReturnType<typeof useCompass>,
  { me, roadNavRef, navMovingRef, followRef, touching, setFollow }: Refs,
) {
  useEffect(() => {
    if (!map) return;
    let frame = 0;
    let latest = 0;
    const off = compass.subscribe((h) => {
      latest = h;
      if (roadNavRef.current) {
        // Slow or standing: GPS course is noise, so the arrow shows where the phone faces.
        if (!navMovingRef.current) me.current?.heading(h);
        return;
      }
      me.current?.facing(h);
      if (followRef.current !== 'compass' || frame) return;
      const turn = () => {
        if (followRef.current !== 'compass') {
          frame = 0;
          return;
        }
        // Another camera move (e.g. the fly-in after tapping locate) runs, or a finger is on
        // the map: try again next frame.
        if (map.isMoving() || touching.current.size) {
          frame = requestAnimationFrame(turn);
          return;
        }
        frame = 0;
        // A turn too small to see is not worth a camera move (each one is a moveend).
        const delta = Math.abs(((latest - map.getBearing() + 540) % 360) - 180);
        if (delta >= 0.5) map.setBearing(latest);
      };
      frame = requestAnimationFrame(turn);
    });
    // Turning the map by hand leaves compass mode but keeps following the position.
    const onRotate = (e: { originalEvent?: Event }) => {
      if (e.originalEvent && followRef.current === 'compass') setFollow('position');
    };
    map.on('rotatestart', onRotate);
    return () => {
      off();
      cancelAnimationFrame(frame);
      map.off('rotatestart', onRotate);
    };
  }, [map, compass, me, roadNavRef, navMovingRef, followRef, touching, setFollow]);
}
