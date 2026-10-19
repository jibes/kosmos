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
import { endsOf, movePoint, pointsOf, removePoint, type Point } from '../core/points';
import { MAX_STOPS, stopsReached } from '../core/stops';
import type { PointListProps } from './PointList';
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
  /** Opens the name-only picker for the point at `at`, or a new stop (`'add'`). */
  pick: (at: number | 'add') => void;
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
  /** A place picked by name for a point of the route (`useStops`): whether it is the end. */
  const pickRef = useRef<(p: Place, at: number | 'add') => boolean>(() => false);
  return { behind, setBehind, addStopRef, pickRef };
}

/**
 * A route's points: start, stops, destination as one list (`PointList`), dragged into another
 * order, changed or taken off on the route card; guiding, those ahead in the banner's panel
 * (each change asks one route from here). Stops come from the card, a label or a point on the
 * map, also while guiding (fuel, a coffee). Guidance counts those passed, so a reroute goes on
 * to the rest only.
 */
export function useStops({
  trip,
  setTrip,
  guided,
  nav,
  navigating,
  state,
  showToast,
  pick,
  skip,
}: Options) {
  const { behind, setBehind, addStopRef, pickRef } = state;
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

  /** "My location" anywhere but first: the position now. */
  const here: Place | null = skip.fix
    ? { name: t.myLocation, detail: '', lng: skip.fix.lng, lat: skip.fix.lat, here: true }
    : null;
  /** The route card's list as the trip's ends; public transport keeps its stops for later. */
  const setPoints = (points: Point[]) =>
    setTrip((tr) => {
      if (!tr) return tr;
      const ends = endsOf(points, here);
      if (!ends) return tr;
      return tr.mode === 'transit' ? { ...tr, from: ends.from, to: ends.to } : { ...tr, ...ends };
    });
  const cardPoints: Point[] = trip
    ? trip.mode === 'transit'
      ? [trip.from, trip.to]
      : pointsOf(trip)
    : [];
  /** Guiding: the stops not yet reached and the destination, after "my location". */
  const ahead: Place[] = trip ? [...viaOf(trip).slice(behind), trip.to] : [];
  const setAhead = (next: Place[]) =>
    setTrip((tr) =>
      tr && next.length
        ? { ...tr, via: [...viaOf(tr).slice(0, behind), ...next.slice(0, -1)], to: next.at(-1)! }
        : tr,
    );

  /** The route card's list of points. */
  const card = {
    points: cardPoints,
    onMove: (from: number, to: number) => {
      logEvent('point.move', { navigating: false });
      setPoints(movePoint(cardPoints, from, to));
    },
    onRemove:
      cardPoints.length > 2
        ? (i: number) => {
            logEvent('point.remove', { navigating: false });
            setPoints(removePoint(cardPoints, i));
          }
        : undefined,
    onPick: pick,
    onAdd: canAdd ? () => pick('add') : undefined,
  };
  /** The points ahead while guiding: moved or taken off, each a route from here. */
  const ahead_: PointListProps = {
    points: [null, ...ahead],
    locked: 1,
    numberFrom: behind,
    onMove: (from, to) => {
      logEvent('point.move', { navigating: true });
      setAhead(movePoint(ahead, from - 1, to - 1));
    },
    onRemove:
      ahead.length > 1
        ? (i) => {
            logEvent('point.remove', { navigating: true });
            setAhead(ahead.filter((_, j) => j !== i - 1));
          }
        : undefined,
  };
  /** A place picked for the point at `i` (a new stop for `'add'`): whether it is the end. */
  const pickPoint = (place: Place, at: number | 'add'): boolean => {
    if (at === 'add') {
      addStop(place);
      return false;
    }
    const next = [...cardPoints];
    next[at] = place;
    setPoints(next);
    return at === cardPoints.length - 1;
  };

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

  useEffect(() => {
    addStopRef.current = addStop;
    pickRef.current = pickPoint;
  });
  return { card, ahead: ahead_ };
}
