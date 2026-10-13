import { CapacitorHttp } from '@capacitor/core';
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
import { parseMotis, TRANSIT_URL, transitUrl } from '../core/transit';
import { isNative } from './native';
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
}

/** A start this close to the last one reuses its route instead of asking the server again. */
const MOVE_TOLERANCE_M = 150;
const NO_ROUTES: Route[] = [];

const tripKey = (trip: Trip) =>
  `${trip.mode}|${trip.mode === 'transit' ? (trip.at ?? 'now') : ''}|${trip.to.lng},${trip.to.lat}|${trip.from ? `${trip.from.lng},${trip.from.lat}` : 'me'}`;

/** A failed reroute must not take the route away from someone who is driving it. */
const keepWhileNavigating = (prev: Result | null, next: Result, pinned: boolean) =>
  pinned && !next.routes.length && prev?.key === next.key && prev.routes.length ? prev : next;

/** Transitous asks apps to name themselves; a browser cannot set User-Agent, the app can. */
const USER_AGENT = `kOSMos/${__BUILD__.version} (+https://github.com/jibes/kosmos)`;

async function getJson(url: string, signal: AbortSignal) {
  if (isNative && url.startsWith(TRANSIT_URL)) {
    const res = await CapacitorHttp.get({ url, headers: { 'User-Agent': USER_AGENT } });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json: res.data };
  }
  const res = await fetch(url, { signal });
  return { ok: res.ok, status: res.status, json: res.ok ? await res.json() : null };
}

/** Asks the router once per trip; following the user's location never polls it. */
export function useRoute(
  trip: Trip | null,
  here: LngLat | null,
  lang: string,
  /** While navigating, only an explicit reroute may ask again, never mere movement. */
  pinned = false,
) {
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
      (trip.from || pinned || distance(prev.from, from) < MOVE_TOLERANCE_M)
    ) {
      return;
    }
    last.current = { key, from, attempt };
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    const ask =
      trip.mode === 'transit'
        ? getJson(transitUrl(from, trip.to, lang, trip.at ?? null), ctrl.signal).then((r) => ({
            ...r,
            routes: r.ok ? parseMotis(r.json) : [],
          }))
        : getJson(routeUrl(from, trip.to, trip.mode, lang), ctrl.signal).then((r) => ({
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
  return { routes, status, key, retry: () => setAttempt((a) => a + 1) };
}
