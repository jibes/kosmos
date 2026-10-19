import type { Place } from './search';
import { MAX_STOPS } from './stops';

/**
 * A route's points as one list, start to end, all alike: the start (`null` for "my location",
 * the live position), the stops on the way, the destination. Moved, changed or taken off in the
 * list, they go back into a trip's `from`, `via` and `to`.
 */
export type Point = Place | null;

export interface Ends {
  from: Place | null;
  via?: Place[];
  to: Place;
}

/** At most this many: a start, the stops, a destination. */
export const MAX_POINTS = MAX_STOPS + 2;

export const pointsOf = (t: Ends): Point[] => [t.from, ...(t.via ?? []), t.to];

/**
 * The list back as a trip's ends. "My location" anywhere but first is the position now
 * (`here`), as the live position can only be where the trip starts; without one there is no
 * such trip (`null`). A place marked `here` back at the start is the live position again.
 */
export function endsOf(points: Point[], here: Place | null): Required<Ends> | null {
  if (points.length < 2) return null;
  const fixed = points.map((p, i) => (i === 0 ? (p?.here ? null : p) : (p ?? here)));
  const to = fixed.at(-1);
  if (!to || fixed.slice(1).some((p) => !p)) return null;
  return { from: fixed[0], via: fixed.slice(1, -1) as Place[], to };
}

/** The point at `from` put at `to`, the rest keeping their order. */
export function movePoint<T>(points: readonly T[], from: number, to: number): T[] {
  const next = [...points];
  if (from === to || from < 0 || from >= next.length) return next;
  const [p] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, p);
  return next;
}

/** Off the list: a route keeps two points at least. */
export const removePoint = <T>(points: readonly T[], i: number): T[] =>
  points.length > 2 ? points.filter((_, j) => j !== i) : [...points];

/** A new stop goes in before the destination. */
export const addPoint = <T>(points: readonly T[], p: T): T[] =>
  points.length >= MAX_POINTS ? [...points] : [...points.slice(0, -1), p, points.at(-1)!];
