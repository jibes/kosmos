import { isAway } from './native';
import type * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { userMarker } from './markers';
import type { useCompass } from './useCompass';
import type { Fix } from './useLocation';

/**
 * What the user's dot costs only while it is seen: its pulse, and the compass that turns its
 * beam. Both stop while the dot is off the map's view, unless the heading is needed anyway
 * (`keep`: the map turning with the compass, guidance).
 */
export function useDotInView(
  map: maplibregl.Map | null,
  fix: Fix | null,
  meRef: RefObject<ReturnType<typeof userMarker> | null>,
  compass: ReturnType<typeof useCompass>,
  keep: boolean,
) {
  const fixRef = useRef(fix);
  const keepRef = useRef(keep);
  const apply = useCallback(() => {
    const f = fixRef.current;
    const seen = !map || !f || map.getBounds().contains([f.lng, f.lat]);
    meRef.current?.away(!seen);
    // Out of sight (the app put away while guiding keeps its page running) nothing shows it.
    compass.need(!isAway() && (seen || keepRef.current));
  }, [map, meRef, compass]);
  useEffect(() => {
    fixRef.current = fix;
    keepRef.current = keep;
    apply();
  });
  useEffect(() => {
    if (!map) return;
    map.on('moveend', apply);
    window.addEventListener('kosmosaway', apply);
    document.addEventListener('visibilitychange', apply);
    return () => {
      map.off('moveend', apply);
      window.removeEventListener('kosmosaway', apply);
      document.removeEventListener('visibilitychange', apply);
    };
  }, [map, apply]);
}
