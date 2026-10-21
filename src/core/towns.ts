import { distance } from './geo';
import { snapNear, type Track } from './nav';

/**
 * The towns a route leads to, from the map's own place labels: what a road sign at a junction
 * would most likely name when the router knows of no sign, before falling back to a compass
 * direction.
 */
export interface Town {
  name: string;
  lng: number;
  lat: number;
  /** OpenMapTiles' `place` class. */
  kind: 'city' | 'town' | 'village';
}

/** A town this near the route counts as on it (its label is at its centre, not on the road). */
export const TOWN_NEAR_M = 2_000;
/** Signs name places this far ahead at most. */
export const TOWN_AHEAD_M = 40_000;
/** Nearer the junction than this, it is the town one is in, not where the road leads. */
export const TOWN_HERE_M = 1_500;
/** Villages are named only this near, a town or city further. */
const VILLAGE_AHEAD_M = 15_000;

/** A town near the route, with where along it the route passes it. */
export interface TownOnWay {
  town: Town;
  /** Metres along the route. */
  along: number;
}

/**
 * The towns near the route, each snapped onto it once and in the order the route reaches them:
 * every junction then reads them, rather than snapping every town again for each (a long
 * drive's hundreds of junctions and villages made that a minute's freeze).
 */
export function townsOnWay(tr: Track, towns: Town[]): TownOnWay[] {
  return snapNear(tr, towns, TOWN_NEAR_M)
    .flatMap((s, i) => (s ? [{ town: towns[i], along: s.along }] : []))
    .sort((a, b) => a.along - b.along);
}

/**
 * The town the route reaches next after `at` metres along it: the first city or town on the
 * way within `TOWN_AHEAD_M`, else the first village within `VILLAGE_AHEAD_M`; never the one
 * the junction is in. `null` when none. Towns as `townsOnWay` gives them (snapped once), or
 * as they come.
 */
export function townAhead(tr: Track, at: number, towns: Town[] | TownOnWay[]): string | null {
  const onWay = (towns as (Town | TownOnWay)[]).every((t) => 'along' in t)
    ? (towns as TownOnWay[])
    : townsOnWay(tr, towns as Town[]);
  const here = pointAlong(tr, at);
  const ahead = onWay.filter(
    ({ town, along }) =>
      along > at && along - at <= TOWN_AHEAD_M && distance(here, town) > TOWN_HERE_M,
  );
  const big = ahead.find(({ town }) => town.kind !== 'village');
  if (big) return big.town.name;
  const near = ahead.find(({ along }) => along - at <= VILLAGE_AHEAD_M);
  return near?.town.name ?? null;
}
function pointAlong(tr: Track, at: number) {
  let i = 0;
  while (i + 1 < tr.along.length && tr.along[i + 1] < at) i++;
  const [lng, lat] = tr.route.coords[i];
  return { lng, lat };
}
