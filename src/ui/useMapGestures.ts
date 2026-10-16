import type * as maplibregl from 'maplibre-gl';
import { useEffect, useRef, type RefObject } from 'react';
import { userMarker } from './markers';

interface Handlers {
  /** The user drags the map: following ends. */
  drag: () => void;
  /** A pinch, twist or tilt by hand: the camera stays where the user puts it. */
  look: () => void;
}

/**
 * The user's dot on the map, and the user's own hands on it. `touching` holds the fingers (or
 * a mouse button) down on the map: the app's own camera moves wait meanwhile, since any move
 * resets MapLibre's gesture handlers, which would cut a pan, pinch or long-press off the
 * moment it starts.
 */
export function useMapGestures(
  map: maplibregl.Map | null,
  meRef: RefObject<ReturnType<typeof userMarker> | null>,
  touchingRef: RefObject<Set<number>>,
  handlers: Handlers,
) {
  const on = useRef(handlers);
  useEffect(() => {
    on.current = handlers;
  });
  useEffect(() => {
    if (!map) return;
    const m = userMarker(map);
    meRef.current = m;
    const down = (e: PointerEvent) => touchingRef.current.add(e.pointerId);
    const up = (e: PointerEvent) => touchingRef.current.delete(e.pointerId);
    const surface = map.getCanvasContainer();
    surface.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    const drag = () => on.current.drag();
    const look = (e: { originalEvent?: Event }) => {
      if (e.originalEvent) on.current.look();
    };
    const looks = ['zoomstart', 'rotatestart', 'pitchstart'] as const;
    map.on('dragstart', drag);
    for (const ev of looks) map.on(ev, look);
    return () => {
      m.remove();
      surface.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      map.off('dragstart', drag);
      for (const ev of looks) map.off(ev, look);
    };
  }, [map, meRef, touchingRef]);
}
