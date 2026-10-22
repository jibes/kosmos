import { distance } from './geo';
import { JUNCTION_ATTRIBUTES } from './junction';
import { ROUTER_URL, encodePolyline, type Mode, type Units } from './route';

/**
 * Speed limits along a road route, from OSM `maxspeed` as the router reads it: one
 * `trace_attributes` request per route followed (by car; it also brings each junction's roads,
 * by any road mode), never per fix. Stretches by distance along
 * the route; a limit is `null` where none is mapped, `Infinity` where there is none by law.
 */
export interface Limits {
  /** Metres along the route where each stretch ends. */
  ends: number[];
  /** km/h for each stretch. */
  kmh: (number | null)[];
}

export const LIMITS_URL = `${ROUTER_URL}/trace_attributes`;

const COSTING: Record<Mode, string> = { car: 'auto', bike: 'bicycle', foot: 'pedestrian' };

/**
 * The request body: the route's own line, matched edge by edge (by snapping where that fails),
 * with the roads at each junction (`core/junction.ts`) besides the limits.
 */
export function limitsBody(coords: [number, number][], mode: Mode = 'car'): string {
  return JSON.stringify({
    encoded_polyline: encodePolyline(coords),
    costing: COSTING[mode],
    shape_match: 'walk_or_snap',
    units: 'kilometers',
    filters: {
      attributes: ['edge.length', 'edge.speed_limit', ...JUNCTION_ATTRIBUTES],
      action: 'include',
    },
  });
}

interface VEdge {
  /** Kilometres. */
  length?: number;
  /** km/h, or "unlimited" (German motorways); absent where none is mapped. */
  speed_limit?: number | string;
}

/** The router's edges as stretches, scaled to the route's own length (`total`, metres). */
export function parseLimits(json: unknown, total: number): Limits | null {
  const edges = (json as { edges?: VEdge[] } | null)?.edges;
  if (!Array.isArray(edges) || !edges.length) return null;
  const sum = edges.reduce((a, e) => a + (e.length ?? 0), 0) * 1000;
  if (!(sum > 0)) return null;
  const scale = total > 0 ? total / sum : 1;
  const out: Limits = { ends: [], kmh: [] };
  let at = 0;
  for (const e of edges) {
    at += (e.length ?? 0) * 1000 * scale;
    const v = e.speed_limit;
    const kmh = v === 'unlimited' ? Infinity : typeof v === 'number' && v > 0 ? v : null;
    // One stretch for a run of the same limit.
    if (out.kmh.length && out.kmh.at(-1) === kmh) out.ends[out.ends.length - 1] = at;
    else {
      out.ends.push(at);
      out.kmh.push(kmh);
    }
  }
  return out;
}

/** The route's length along its points, metres. */
export function lengthOf(coords: [number, number][]): number {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]];
    m += distance({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
  }
  return m;
}

/** The limit `along` metres into the route, km/h. */
export function limitAt(limits: Limits | null, along: number): number | null {
  if (!limits) return null;
  const i = limits.ends.findIndex((end) => along < end);
  return limits.kmh[i === -1 ? limits.kmh.length - 1 : i] ?? null;
}

/**
 * Too fast to let pass: more than 5 % over, and at least 3 km/h, so a speedometer's own error
 * and GPS jitter at the limit do not flash red.
 */
export function overLimit(mps: number, kmh: number | null): boolean {
  if (kmh == null || !Number.isFinite(kmh)) return false;
  return mps * 3.6 > kmh + Math.max(3, kmh * 0.05);
}

/** The limit as the signs show it: mph where the roads count in miles. */
export function limitIn(kmh: number, units: Units): number {
  if (units === 'metric') return Math.round(kmh);
  // OSM maps "30 mph" as such; the router hands it over as 48.28 km/h.
  return Math.round(kmh / 1.609344);
}
