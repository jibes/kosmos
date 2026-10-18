import { ARRIVE_M, type NavState, type Track } from './nav';
import type { Mode, Route } from './route';

/**
 * Stops on the way (a coffee, someone picked up, fuel): the router arrives at each and sets off
 * again, so the route has a maneuver for each; they are visited in the order given.
 */

/** A few at most: more is planning a tour, not a trip. */
export const MAX_STOPS = 3;

/** The stops with the one at `i` a place earlier, never before `first` (those reached). */
export function moveStopUp<T>(via: readonly T[], i: number, first = 0): T[] {
  if (i <= first || i >= via.length) return [...via];
  const next = [...via];
  [next[i - 1], next[i]] = [next[i], next[i - 1]];
  return next;
}

/** The words for a stop by its name: banner, early alert ("In 300 m, stop at …"), arrival. */
export interface StopWords {
  instruction: (name: string) => string;
  alert: (name: string) => string;
  pre: (name: string) => string;
}

/**
 * The route's stops said by name, not as the router's "You have arrived": each stop maneuver
 * also learns which of the trip's stops it is, `first` being the trip's stop the request began
 * with (those reached before are not asked for again).
 */
export function nameStops(
  route: Route,
  names: readonly string[],
  first: number,
  words: StopWords,
): Route {
  if (!route.maneuvers.some((m) => m.stop !== undefined)) return route;
  return {
    ...route,
    maneuvers: route.maneuvers.map((m) => {
      if (m.stop === undefined) return m;
      const via = first + m.stop;
      const name = names[via] ?? '';
      return {
        ...m,
        via,
        instruction: words.instruction(name),
        alert: words.alert(name),
        pre: words.pre(name),
        post: undefined,
      };
    }),
  };
}

/**
 * How many of the trip's stops are behind: in order, so the last one reached says it. Reached
 * is at it (within `ARRIVE_M` along the route), not only past it: parked there and walking
 * about, a reroute must not send the user back to it.
 */
export function stopsReached(
  tr: Track,
  st: Pick<NavState, 'next' | 'snap' | 'offRoute'>,
  before: number,
): number {
  let reached = before;
  const along = st.snap && !st.offRoute ? st.snap.along : -Infinity;
  tr.route.maneuvers.forEach((m, i) => {
    if (m.via === undefined) return;
    if (i < st.next || along >= tr.at[i] - ARRIVE_M) reached = Math.max(reached, m.via + 1);
  });
  return reached;
}

/** Off the route and this much further from the next stop than the closest yet: left behind. */
export const SKIP_AWAY_M: Record<Mode, number> = { car: 1000, bike: 400, foot: 150 };
/** How long the question waits before the stop is skipped by itself. */
export const SKIP_DELAY_MS = 10_000;

/** Watching the next stop while guiding: the closest the user came to it. */
export interface StopWatch {
  /** The trip's stop watched (`Trip.via` index). */
  stop: number;
  closest: number;
}

/**
 * Whether the user is leaving the next stop behind: off the route (on it, the way to the stop
 * may wind away from it) and well beyond the closest they came. A new stop starts afresh.
 */
export function leavingStop(
  prev: StopWatch | null,
  stop: number,
  dist: number,
  offRoute: boolean,
  mode: Mode,
): { watch: StopWatch; leaving: boolean } {
  const closest = prev && prev.stop === stop ? Math.min(prev.closest, dist) : dist;
  return {
    watch: { stop, closest },
    leaving: offRoute && dist > closest + SKIP_AWAY_M[mode],
  };
}
