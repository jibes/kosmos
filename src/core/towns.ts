import { distance } from './geo';
import { snap, type Track } from './nav';

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

/**
 * The town the route reaches next after `at` metres along it: the first city or town on the
 * way within `TOWN_AHEAD_M`, else the first village within `VILLAGE_AHEAD_M`; never the one
 * the junction is in. `null` when none.
 */
export function townAhead(tr: Track, at: number, towns: Town[]): string | null {
  const here = pointAlong(tr, at);
  const ahead = towns
    .map((town) => ({ town, s: snap(tr, town) }))
    .filter(
      ({ town, s }) =>
        s.offset <= TOWN_NEAR_M &&
        s.along > at &&
        s.along - at <= TOWN_AHEAD_M &&
        distance(here, town) > TOWN_HERE_M,
    )
    .sort((a, b) => a.s.along - b.s.along);
  const big = ahead.find(({ town }) => town.kind !== 'village');
  if (big) return big.town.name;
  const near = ahead.find(({ s }) => s.along - at <= VILLAGE_AHEAD_M);
  return near?.town.name ?? null;
}

function pointAlong(tr: Track, at: number) {
  let i = 0;
  while (i + 1 < tr.along.length && tr.along[i + 1] < at) i++;
  const [lng, lat] = tr.route.coords[i];
  return { lng, lat };
}
