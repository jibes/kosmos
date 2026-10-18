import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { LngLat } from '../core/geo';
import { track, type NavState } from '../core/nav';
import type { Mode, Route } from '../core/route';
import type { Place } from '../core/search';
import { MAX_STOPS, moveStopUp, stopsReached } from '../core/stops';
import { fill, t } from '../i18n';
import { logEvent } from './usageLog';
import { viaOf, type Trip } from './useRoute';
import { useStopSkip } from './useStopSkip';
import type { Voice } from './voice';

interface Options {
  trip: Trip | null;
  setTrip: Dispatch<SetStateAction<Trip | null>>;
  /** The route being guided along, and the maneuver ahead on it. */
  guided: Route | undefined;
  nav: NavState;
  navigating: boolean;
  state: ReturnType<typeof useStopState>;
  showToast: (text: string, actions?: { label: string; run: () => void }[], ms?: number) => void;
  /** Opens the name-only picker for a stop. */
  pickStop: () => void;
  /** For asking whether to skip a stop left behind (`useStopSkip`). */
  skip: {
    fix: LngLat | null;
    mode: Mode;
    voice: Voice;
    muted: boolean;
    reroute: () => void;
    dismissText: (text: string) => void;
  };
}

/**
 * What the stops share with what is set up before them in App: those reached while guiding
 * (`useRoute` reads them at request time), and `addStop` for the pickers and taps.
 */
export function useStopState() {
  const [behind, setBehind] = useState(0);
  const addStopRef = useRef<(p: Place) => void>(() => undefined);
  return { behind, setBehind, addStopRef };
}

/**
 * Stops on the way: added from the route card, a label or a point on the map (also while
 * guiding: fuel, a coffee), moved earlier or taken off on the card and, guiding, in the
 * steps panel (each change asks one route from here). Guidance counts those passed, so a reroute
 * goes on to the rest only.
 */
export function useStops({
  trip,
  setTrip,
  guided,
  nav,
  navigating,
  state,
  showToast,
  pickStop,
  skip,
}: Options) {
  const { behind, setBehind, addStopRef } = state;
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
  /** A place earlier on the way; guiding, never before one already reached. */
  const moveUp = useCallback(
    (i: number) => {
      logEvent('stop.move', { navigating });
      setTrip((tr) =>
        tr ? { ...tr, via: moveStopUp(viaOf(tr), i, navigating ? behind : 0) } : tr,
      );
    },
    [setTrip, navigating, behind],
  );
  const { voice, muted, ...rest } = skip;
  useStopSkip({
    ...rest,
    navigating,
    via: viaOf(trip),
    behind,
    setBehind,
    offRoute: nav.offRoute,
    showToast,
    say: (text) => {
      if (muted) return false;
      voice.speak(text);
      return true;
    },
  });

  /** For `StopList`: the stops still ahead, to move or take off. */
  const list = {
    via: viaOf(trip),
    first: navigating ? behind : 0,
    onMoveUp: moveUp,
    onRemove: removeStop,
  };
  useEffect(() => {
    addStopRef.current = addStop;
  });
  /** The route card's stop props. */
  const card = {
    via: list.via,
    onAddStop: canAdd ? pickStop : undefined,
    onRemoveStop: removeStop,
    onMoveStopUp: moveUp,
  };
  return { list, card };
}
