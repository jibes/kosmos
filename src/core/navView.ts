import { distance } from './geo';
import { navZoom } from './nav';
import type { Mode } from './route';
import type { RideState } from './ride';
import type { Transit } from './transit';

/**
 * How guidance looks at the map, per way of travel: by car from behind and above, the road
 * ahead first; by bike flatter and closer, so side streets stay readable; on foot straight
 * from above and closest, as paths beside the road matter.
 */
export function navPitch(mode: Mode): number {
  return mode === 'car' ? 55 : mode === 'bike' ? 30 : 0;
}

export function navZoomFor(mode: Mode, speed: number): number {
  return mode === 'car' ? navZoom(speed) : mode === 'bike' ? 17.5 : 18;
}

type Pt = [number, number];

/** What is left of a road route from the user on: the point on it, then the rest. */
export function routeRest(coords: Pt[], segment: number, point: Pt): Pt[] {
  return [point, ...coords.slice(Math.max(0, segment + 1))];
}

/** The index of the point of `coords` nearest `p`. */
function nearestIndex(coords: Pt[], p: Pt): number {
  let best = 0;
  let least = Infinity;
  coords.forEach(([lng, lat], i) => {
    const d = distance({ lng, lat }, { lng: p[0], lat: p[1] });
    if (d < least) {
      least = d;
      best = i;
    }
  });
  return best;
}

/**
 * What is left of a public transport trip from where the rider is: on board, the rest of the
 * line to the stop to get off at (`trip` false), or everything to the destination (`trip`).
 */
export function tripRest(transit: Transit, st: RideState, at: Pt | null, trip: boolean): Pt[] {
  const legs = transit.legs.slice(st.leg);
  if (!legs.length) return at ? [at] : [];
  const [first, ...later] = legs;
  const from = at && first.coords.length ? nearestIndex(first.coords, at) : 0;
  const here = first.coords.slice(from);
  const rest = trip ? later.flatMap((l) => l.coords) : [];
  return [...(at ? [at] : []), ...here, ...rest];
}

/** West-south and east-north corners of some points. */
export function boundsOf(points: Pt[]): [Pt, Pt] | null {
  if (!points.length) return null;
  let [w, s] = points[0];
  let [e, n] = points[0];
  for (const [lng, lat] of points) {
    w = Math.min(w, lng);
    e = Math.max(e, lng);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return [
    [w, s],
    [e, n],
  ];
}
