import { useEffect, useRef, useState } from 'react';
import { distance, type LngLat } from '../core/geo';
import { courseOf, type Course } from '../core/nav';
import {
  classifyError,
  parseValhalla,
  routeUrl,
  needsTollFree,
  withTollFree,
  type Mode,
  type Route,
  type RouteError,
  type TravelMode,
} from '../core/route';
import { narrateWays, type ExitWords } from '../core/roundabout';
import { nameStops, type StopWords } from '../core/stops';
import type { Place } from '../core/search';
import { parseMotis, transitUrl } from '../core/transit';
import { fill, t, units } from '../i18n';
import { getJson } from './http';
import { logEvent } from './usageLog';
import type { RouteStatus } from './RouteCard';

export interface Trip {
  to: Place;
  /** `null` routes from the user's location. */
  from: Place | null;
  mode: TravelMode;
  /** Public transport departure, epoch ms; `null` or absent leaves now. */
  at?: number | null;
  /** Stops on the way by road, in order (`MAX_STOPS`); public transport goes straight. */
  via?: Place[];
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

/** The way out of a roundabout, in the UI's language, as the router's own words are. */
const EXIT_WORDS: ExitWords = {
  toward: (place) => fill(t.exitToward, { place }),
  heading: (way) => fill(t.exitHeading, { way: t[`way_${way}`] }),
  junction: (n) => fill(t.sayJunction, { n }),
};

/** A stop said by its name. */
const STOP_WORDS: StopWords = {
  instruction: (name) => fill(t.stopAt, { name }),
  alert: (name) => fill(t.stopAhead, { name }),
  pre: (name) => fill(t.stopHere, { name }),
};

/** The stops a road trip goes by; public transport has none. */
const NO_STOPS: Place[] = [];
export const viaOf = (trip: Trip | null) =>
  !trip || trip.mode === 'transit' ? NO_STOPS : (trip.via ?? NO_STOPS);

const tripKey = (trip: Trip) =>
  `${trip.mode}|${trip.mode === 'transit' ? (trip.at ?? 'now') : ''}|${trip.to.lng},${trip.to.lat}|${viaOf(
    trip,
  )
    .map((v) => `${v.lng},${v.lat}`)
    .join(';')}|${trip.from ? `${trip.from.lng},${trip.from.lat}` : 'me'}`;

/**
 * Two trips from here to the same end, its stops changed: the way followed still leads there
 * meanwhile. Not for a new destination: the old way would arrive, and end the trip, at the old.
 */
const sameEnd = (a: string, b: string) =>
  a.endsWith('|me') && b.endsWith('|me') && a.split('|')[2] === b.split('|')[2];

/**
 * A failed reroute must not take the route away from someone who is following it, nor a failed
 * new connection the one being ridden (asked from elsewhere, under another key).
 */
const keepWhileNavigating = (
  prev: Result | null,
  next: Omit<Result, 'n'>,
  pinned: boolean,
  transit: boolean,
): Result => {
  const n = (prev?.n ?? 0) + 1;
  // Across a key change only for a connection (its new start is the stop), or a stop added
  // while guiding from here: a road route from a chosen start is no way from where the user
  // now is.
  const same = prev?.key === next.key || (transit && !!prev) || sameEnd(next.key, prev?.key ?? '');
  return pinned && !next.routes.length && same && prev?.routes.length
    ? { ...prev!, key: next.key, kept: true, n }
    : { ...next, n };
};

/** Asks the router once per trip; following the user's location never polls it. */
export function useRoute(
  trip: Trip | null,
  here: (LngLat & { accuracy?: number; heading?: number | null; speed?: number | null }) | null,
  lang: string,
  /** While navigating, only an explicit reroute may ask again, never mere movement. */
  pinned = false,
  /**
   * Driving a toll-free route that was chosen over toll ones: reroutes stay toll-free. Read
   * when a request is made, never a reason to ask.
   */
  avoidTolls = false,
  /** Stops already reached while guiding: a reroute goes on to the rest. Read when asking. */
  stopsBehind = 0,
) {
  const tollFreeRef = useRef(avoidTolls);
  const behindRef = useRef(stopsBehind);
  useEffect(() => {
    tollFreeRef.current = avoidTolls;
    behindRef.current = stopsBehind;
  });
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  // A route closed and opened again asks afresh: the last answer (a timetable especially) is old.
  const [open, setOpen] = useState(!!trip);
  if (open !== !!trip) {
    setOpen(!!trip);
    if (!trip) setResult(null);
  }
  // The way last driven, for a reroute asked while standing in traffic.
  const course = useRef<Course | null>(null);
  useEffect(() => {
    if (here) course.current = courseOf(here, course.current, Date.now());
  }, [here]);
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
    const behind = pinned ? behindRef.current : 0;
    const via = viaOf(trip).slice(behind);
    // The usage log: which way a reroute was asked to leave in.
    if (pinned && trip.mode !== 'transit') {
      const c = course.current;
      logEvent('route.heading', { sent: !!c, kept: !!c && c.at < Date.now() - 1500 });
    }
    const names = viaOf(trip).map((v) => v.name);
    const road = (alternates: number, noTolls: boolean) =>
      getJson(
        // A reroute while guiding: one route, leaving in the direction of travel (the one last
        // driven while standing in traffic).
        routeUrl(
          pinned && !trip.from && course.current
            ? { ...from, heading: course.current.heading }
            : from,
          trip.to,
          trip.mode as Mode,
          lang,
          alternates,
          units,
          noTolls,
          via,
        ),
        ctrl.signal,
      ).then((r) => ({
        ...r,
        routes: r.ok
          ? parseValhalla(r.json).map((x) =>
              nameStops(narrateWays(x, EXIT_WORDS), names, behind, STOP_WORDS),
            )
          : [],
      }));
    const ask =
      trip.mode === 'transit'
        ? getJson(transitUrl(from, trip.to, lang, trip.at ?? null), ctrl.signal).then((r) => ({
            ...r,
            routes: r.ok
              ? parseMotis(r.json).map((x) =>
                  x.transit ? { ...x, transit: { ...x.transit, planned: Date.now() } } : x,
                )
              : [],
          }))
        : pinned
          ? road(0, trip.mode === 'car' && tollFreeRef.current)
          : road(2, false).then(async (r) => {
              // Every way found by car has toll roads: one more request for a way without, so
              // there is always one to choose (marked by its absence of coins).
              if (trip.mode !== 'car' || !needsTollFree(r.routes)) return r;
              const free = await road(0, true).catch(() => null);
              return { ...r, routes: withTollFree(r.routes, free?.routes ?? []) };
            });
    ask
      .then(({ ok, status, routes }) => {
        if (ctrl.signal.aborted) return;
        const error = ok ? 'none' : classifyError(status);
        setResult((prev) =>
          keepWhileNavigating(prev, { key, routes, error }, pinned, trip.mode === 'transit'),
        );
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setResult((prev) =>
          keepWhileNavigating(
            prev,
            { key, routes: [], error: 'failed' },
            pinned,
            trip.mode === 'transit',
          ),
        );
      });
  }, [trip, here, key, lang, attempt, pinned]);

  const current = !!trip && result?.key === key;
  let status: RouteStatus = 'loading';
  if (current && result) {
    status = result.routes.length ? 'ready' : result.error === 'none' ? 'none' : result.error;
  } else if (trip && !trip.from && !here) {
    status = 'locating';
  }
  // A new connection asked for while riding, or the stops changed while guiding from here: the
  // way followed stays until the new one comes, so guidance never blanks.
  const waiting =
    pinned && !!result?.routes.length && (trip?.mode === 'transit' || sameEnd(key, result.key));
  const routes = current && result ? result.routes : waiting ? result!.routes : NO_ROUTES;
  return {
    routes,
    status,
    key,
    settled: result?.n ?? 0,
    /** The routes are for the trip as it is now, not the one followed while asking. */
    current,
    kept: !!result?.kept,
    retry: () => setAttempt((a) => a + 1),
  };
}
