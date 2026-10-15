import { useEffect, useRef, useState } from 'react';
import { distance, type LngLat } from '../core/geo';
import {
  classifyError,
  parseValhalla,
  routeUrl,
  type Route,
  type RouteError,
  type TravelMode,
} from '../core/route';
import type { Place } from '../core/search';
import { parseMotis, transitUrl } from '../core/transit';
import { units } from '../i18n';
import { getJson } from './http';
import type { RouteStatus } from './RouteCard';

export interface Trip {
  to: Place;
  /** `null` routes from the user's location. */
  from: Place | null;
  mode: TravelMode;
  /** Public transport departure, epoch ms; `null` or absent leaves now. */
  at?: number | null;
}

interface Result {
  key: string;
  routes: Route[];
  error: RouteError;
  /** The last answer failed and the route being driven was kept. */
  kept?: boolean;
  /** Counts answers, so a caller can tell when the one it asked for came. */
  n: number;
}

/** A start this close to the last one reuses its route instead of asking the server again. */
const MOVE_TOLERANCE_M = 150;
/** Moving on with a road route open asks again at most this often. */
const REFRESH_MS = 60_000;
const NO_ROUTES: Route[] = [];

const tripKey = (trip: Trip) =>
  `${trip.mode}|${trip.mode === 'transit' ? (trip.at ?? 'now') : ''}|${trip.to.lng},${trip.to.lat}|${trip.from ? `${trip.from.lng},${trip.from.lat}` : 'me'}`;

/** A failed reroute must not take the route away from someone who is driving it. */
const keepWhileNavigating = (
  prev: Result | null,
  next: Omit<Result, 'n'>,
  pinned: boolean,
): Result => {
  const n = (prev?.n ?? 0) + 1;
  return pinned && !next.routes.length && prev?.key === next.key && prev.routes.length
    ? { ...prev, kept: true, n }
    : { ...next, n };
};

/** Asks the router once per trip; following the user's location never polls it. */
export function useRoute(
  trip: Trip | null,
  here: (LngLat & { accuracy?: number; heading?: number | null; speed?: number | null }) | null,
  lang: string,
  /** While navigating, only an explicit reroute may ask again, never mere movement. */
  pinned = false,
) {
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  const last = useRef<{ key: string; from: LngLat; attempt: number; at: number } | null>(null);
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
    if (prev && prev.key === key && prev.attempt === attempt) {
      // A chosen start, guidance (which reroutes by itself) and public transport (a plan is
      // for the trip, not for each step taken) never ask again by themselves. A road route
      // follows a walker or passenger, but not GPS jitter and not more than once a minute.
      if (trip.from || pinned || trip.mode === 'transit') return;
      const slack = Math.max(MOVE_TOLERANCE_M, 2 * (here?.accuracy ?? 0));
      if (distance(prev.from, from) < slack || Date.now() - prev.at < REFRESH_MS) return;
    }
    last.current = { key, from, attempt, at: Date.now() };
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    const ask =
      trip.mode === 'transit'
        ? getJson(transitUrl(from, trip.to, lang, trip.at ?? null), ctrl.signal).then((r) => ({
            ...r,
            routes: r.ok ? parseMotis(r.json) : [],
          }))
        : getJson(
            // A reroute while guiding: one route, leaving in the direction of travel.
            routeUrl(
              pinned && !trip.from && here?.heading != null && (here.speed ?? 0) > 2
                ? { ...from, heading: here.heading }
                : from,
              trip.to,
              trip.mode,
              lang,
              pinned ? 0 : 2,
              units,
            ),
            ctrl.signal,
          ).then((r) => ({
            ...r,
            routes: r.ok ? parseValhalla(r.json) : [],
          }));
    ask
      .then(({ ok, status, routes }) => {
        if (ctrl.signal.aborted) return;
        const error = ok ? 'none' : classifyError(status);
        setResult((prev) => keepWhileNavigating(prev, { key, routes, error }, pinned));
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setResult((prev) =>
          keepWhileNavigating(prev, { key, routes: [], error: 'failed' }, pinned),
        );
      });
  }, [trip, here, key, lang, attempt, pinned]);

  let status: RouteStatus = 'loading';
  if (trip && result?.key === key) {
    status = result.routes.length ? 'ready' : result.error === 'none' ? 'none' : result.error;
  } else if (trip && !trip.from && !here) {
    status = 'locating';
  }
  const routes = trip && result?.key === key ? result.routes : NO_ROUTES;
  return {
    routes,
    status,
    key,
    settled: result?.n ?? 0,
    kept: !!result?.kept,
    retry: () => setAttempt((a) => a + 1),
  };
}
