import { ARRIVE_M, type NavState, type Track } from './nav';
import type { Route } from './route';

/**
 * Stops on the way (a coffee, someone picked up, fuel): the router arrives at each and sets off
 * again, so the route has a maneuver for each; they are visited in the order given.
 */

/** A few at most: more is planning a tour, not a trip. */
export const MAX_STOPS = 3;

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
