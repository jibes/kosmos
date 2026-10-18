import type * as maplibregl from 'maplibre-gl';
import { useCallback } from 'react';
import type { Follow } from './Controls';
import { motion } from './motion';
import { logEvent } from './usageLog';
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
  const { overviewRef, setOverview, level, unlevel } = view;
  /** Following again after looking around: heading-up where it can, as each trip starts. */
  const resume = useCallback(
    () => setFollow(canTurn ? 'compass' : 'position'),
    [setFollow, canTurn],
  );

  /** Follow the user again: out of the overview, or after looking around; always back to them. */
  const locate = useCallback(() => {
    logEvent('cam.locate', { from: overviewRef.current ? 'overview' : follow });
    if (overviewRef.current) setOverview(false);
    if (follow === 'off') resume();
    recenter();
  }, [follow, overviewRef, setOverview, resume, recenter]);

  const toggleOverview = useCallback(() => {
    const on = !overviewRef.current;
    logEvent('cam.overview', { on });
    setOverview(on);
    if (!on && follow === 'off') resume();
    recenter();
  }, [overviewRef, setOverview, follow, resume, recenter]);

  /**
   * The needle: north up and flat from heading-up or a hand's turn; else heading-up again, at
   * the way of travel's own tilt, following.
   */
  const turn = useCallback(() => {
    const turned = !!map && (Math.abs(map.getBearing()) > 0.5 || map.getPitch() > 0.5);
    logEvent('cam.turn', { from: follow, turned });
    if (follow === 'compass' || turned) {
      if (follow === 'compass') setFollow('position');
      level();
      map?.easeTo({ bearing: 0, pitch: 0, duration: motion(500) });
      recenter(0);
      return;
    }
    if (!canTurn) return;
    unlevel();
    if (overviewRef.current) setOverview(false);
    setFollow('compass');
    recenter();
  }, [map, follow, setFollow, level, unlevel, canTurn, overviewRef, setOverview, recenter]);

  return { locate, toggleOverview, turn };
}
