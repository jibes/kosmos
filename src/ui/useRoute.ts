import { useEffect, useRef, useState } from 'react';
import { distance, type LngLat } from '../core/geo';
import {
  classifyError,
  parseValhalla,
  routeUrl,
  type Mode,
  type Route,
  type RouteError,
} from '../core/route';
import type { Place } from '../core/search';
import type { RouteStatus } from './RouteCard';

export interface Trip {
  to: Place;
  /** `null` routes from the user's location. */
  from: Place | null;
  mode: Mode;
}

interface Result {
  key: string;
  routes: Route[];
  error: RouteError;
}

/** A start this close to the last one reuses its route instead of asking the server again. */
const MOVE_TOLERANCE_M = 150;
const NO_ROUTES: Route[] = [];

const tripKey = (trip: Trip) =>
  `${trip.mode}|${trip.to.lng},${trip.to.lat}|${trip.from ? `${trip.from.lng},${trip.from.lat}` : 'me'}`;

/** Asks the router once per trip; following the user's location never polls it. */
export function useRoute(trip: Trip | null, here: LngLat | null, lang: string) {
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  const last = useRef<{ key: string; from: LngLat; attempt: number } | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const key = trip ? tripKey(trip) : '';

  useEffect(() => {
    if (!trip) {
      last.current = null;
      inflight.current?.abort();
      return;
    }
    const from = trip.from ?? here;
    if (!from) return;
    const prev = last.current;
    if (
      prev &&
      prev.key === key &&
      prev.attempt === attempt &&
      (trip.from || distance(prev.from, from) < MOVE_TOLERANCE_M)
    ) {
      return;
    }
    last.current = { key, from, attempt };
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    fetch(routeUrl(from, trip.to, trip.mode, lang), { signal: ctrl.signal })
      .then(async (res) => {
        const routes = res.ok ? parseValhalla(await res.json()) : [];
        const error = res.ok ? 'none' : classifyError(res.status);
        setResult({ key, routes, error });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setResult({ key, routes: [], error: 'failed' });
      });
  }, [trip, here, key, lang, attempt]);

  let status: RouteStatus = 'loading';
  if (trip && result?.key === key) {
    status = result.routes.length ? 'ready' : result.error === 'none' ? 'none' : result.error;
  } else if (trip && !trip.from && !here) {
    status = 'locating';
  }
  const routes = trip && result?.key === key ? result.routes : NO_ROUTES;
  return { routes, status, key, retry: () => setAttempt((a) => a + 1) };
}
