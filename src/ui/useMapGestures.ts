import { isAway } from './native';
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
    const down = (e: PointerEvent) => {
      // The first finger: none is down, whatever a lost "up" left behind (the app put away
      // mid-touch never hears it, and the camera would wait for good).
      if (e.isPrimary) touchingRef.current.clear();
      touchingRef.current.add(e.pointerId);
    };
    const up = (e: PointerEvent) => touchingRef.current.delete(e.pointerId);
    const away = () => {
      if (isAway()) touchingRef.current.clear();
    };
    const surface = map.getCanvasContainer();
    surface.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    document.addEventListener('visibilitychange', away);
    window.addEventListener('kosmosaway', away);
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
      document.removeEventListener('visibilitychange', away);
      window.removeEventListener('kosmosaway', away);
      map.off('dragstart', drag);
      for (const ev of looks) map.off(ev, look);
    };
  }, [map, meRef, touchingRef]);
}
