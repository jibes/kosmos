import type * as maplibregl from 'maplibre-gl';
import { useCallback } from 'react';
import type { Follow } from './Controls';
import { motion } from './motion';
import type { useNavView } from './useNavView';

interface Options {
  map: maplibregl.Map | null;
  follow: Follow;
  setFollow: (f: Follow) => void;
  view: ReturnType<typeof useNavView>;
  /** Road guidance turns heading-up by the way it goes; public transport by the compass. */
  canTurn: boolean;
  /**
   * Moves the camera as the controls now say (road guidance; the ride's camera reacts itself).
   * `setFollow` updates the ref it reads at once, so this may run straight after.
   */
  recenter: (bearing?: number) => void;
}

/**
 * The map's buttons while guiding, the same as on the map: what the camera tracks is nothing,
 * the user (the location button) or the rest of the way (the overview); following, the location
 * button turns heading-up and back to north up. Zoom and tilt are the user's at any time.
 */
export function useNavControls({ map, follow, setFollow, view, canTurn, recenter }: Options) {
  const { overviewRef, setOverview, level } = view;
  /** Following again after looking around: heading-up where it can, as each trip starts. */
  const resume = useCallback(
    () => setFollow(canTurn ? 'compass' : 'position'),
    [setFollow, canTurn],
  );

  const locate = useCallback(() => {
    if (overviewRef.current) {
      setOverview(false);
      if (follow === 'off') resume();
    } else if (follow === 'off') {
      resume();
    } else if (follow === 'position') {
      if (!canTurn) return false;
      setFollow('compass');
    } else {
      setFollow('position');
      map?.easeTo({ bearing: 0, duration: motion(500) });
      recenter(0);
      return true;
    }
    recenter();
    return true;
  }, [map, follow, setFollow, overviewRef, setOverview, resume, canTurn, recenter]);

  const toggleOverview = useCallback(() => {
    const on = !overviewRef.current;
    setOverview(on);
    if (!on && follow === 'off') resume();
    recenter();
  }, [overviewRef, setOverview, follow, resume, recenter]);

  /** North up and flat; heading-up gives way to following with north up. */
  const north = useCallback(() => {
    if (follow === 'compass') setFollow('position');
    level();
    map?.easeTo({ bearing: 0, pitch: 0, duration: motion(500) });
    recenter(0);
  }, [map, follow, setFollow, level, recenter]);

  return { locate, toggleOverview, north };
}
