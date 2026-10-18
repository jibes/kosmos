import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { track, type NavState } from '../core/nav';
import type { Route } from '../core/route';
import type { Place } from '../core/search';
import { MAX_STOPS, stopsReached } from '../core/stops';
import { fill, t } from '../i18n';
import { logEvent } from './usageLog';
import { viaOf, type Trip } from './useRoute';

interface Options {
  trip: Trip | null;
  setTrip: Dispatch<SetStateAction<Trip | null>>;
  /** The route being guided along, and the maneuver ahead on it. */
  guided: Route | undefined;
  nav: NavState;
  navigating: boolean;
  setBehind: Dispatch<SetStateAction<number>>;
  showToast: (text: string) => void;
}

/**
 * Stops on the way: added from the route card, a label or a point on the map (also while
 * guiding: fuel, a coffee), taken off on the card. Guidance counts those passed, so a reroute
 * goes on to the rest only.
 */
export function useStops({
  trip,
  setTrip,
  guided,
  nav,
  navigating,
  setBehind,
  showToast,
}: Options) {
  // Each drive starts with every stop ahead.
  useEffect(() => {
    if (navigating) setBehind(0);
  }, [navigating, setBehind]);
  const tr = useMemo(() => (guided ? track(guided) : null), [guided]);
  useEffect(() => {
    if (navigating && tr) setBehind((b) => stopsReached(tr, nav, b));
  }, [navigating, tr, nav, setBehind]);

  const canAdd = !!trip && trip.mode !== 'transit' && viaOf(trip).length < MAX_STOPS;
  const addStop = useCallback(
    (place: Place) => {
      setTrip((tr) => {
        if (!tr || tr.mode === 'transit' || viaOf(tr).length >= MAX_STOPS) return tr;
        return { ...tr, via: [...viaOf(tr), place] };
      });
      logEvent('stop.add', { navigating });
      showToast(fill(t.stopAdded, { name: place.name }));
    },
    [setTrip, showToast, navigating],
  );
  const removeStop = useCallback(
    (i: number) => {
      logEvent('stop.remove');
      setTrip((tr) => (tr ? { ...tr, via: viaOf(tr).filter((_, j) => j !== i) } : tr));
    },
    [setTrip],
  );
  return { canAdd, addStop, removeStop };
}
