import type { Category } from './categories';
import type { LngLat } from './geo';
import { pointAt, snapNear, type Track } from './nav';
import type { Mode } from './route';
import { DETAIL_ZOOM, tilesIn, type TileId } from './tiles';

/**
 * Places along the rest of a route: within a band either side of it and a reach ahead, by how
 * far along the way they are and how much of a detour they make. The tiles are those under the
 * band, read as the map's own category search reads them; no router is asked.
 */

/** How far either side of the route, and how far ahead, by way of travel (metres). */
export const ALONG: Record<Mode, { band: number; reach: number }> = {
  car: { band: 500, reach: 50_000 },
  bike: { band: 250, reach: 15_000 },
  foot: { band: 150, reach: 3_000 },
};

/** At most this many tiles are read: about 50 km of road at zoom 14. */
export const ALONG_TILES = 60;
/** At most this many places are listed, the nearest along the way. */
export const ALONG_MAX = 30;

/** The kinds of place a trip stops for, offered first. */
export const TRIP_KINDS: Category[] = [
  'fuel',
  'charging',
  'toilets',
  'cafe',
  'fast_food',
  'restaurant',
  'groceries',
  'parking',
];

/** Speed of the way off the route and back, to tell a detour's time (m/s). */
const DETOUR_MS: Record<Mode, number> = { car: 8, bike: 4, foot: 1.3 };
/** Closer than this to the route, a place is on the way. */
export const ON_THE_WAY_M = 30;

const M_PER_DEG = 111_320;

/**
 * The zoom-14 tiles under the band along the route from `from` metres to `reach` past it, in
 * the order the way reaches them, each once, at most `max`.
 */
export function tilesAlong(
  tr: Track,
  from: number,
  mode: Mode | { band: number; reach: number },
  max = ALONG_TILES,
  z = DETAIL_ZOOM,
): TileId[] {
  const { band, reach } = typeof mode === 'string' ? ALONG[mode] : mode;
  const end = Math.min(tr.along.at(-1) ?? 0, from + reach);
  // A step well under a tile's size, so the band between two samples is never missed.
  const tileM = (40_075_000 * Math.cos((tr.lat0 * Math.PI) / 180)) / 2 ** z;
  const step = Math.max(50, Math.min(tileM / 3, band));
  const seen = new Set<string>();
  const out: TileId[] = [];
  for (let a = from; a <= end + step / 2 && out.length < max; a += step) {
    const [lng, lat] = pointAt(tr, Math.min(a, end)).point;
    const dLat = band / M_PER_DEG;
    const dLng = band / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
    const box = { west: lng - dLng, south: lat - dLat, east: lng + dLng, north: lat + dLat };
    for (const t of tilesIn(box, { lng, lat }, z, 9)) {
      const key = `${t.x}/${t.y}`;
      if (seen.has(key) || out.length >= max) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

export interface AlongHit<T> {
  it: T;
  /** Metres along the way from here. */
  ahead: number;
  /** Metres off the route. */
  off: number;
  /** Seconds the way there and back adds; 0 on the way. */
  detour: number;
}

/**
 * The places within the band and ahead of `from`, nearest along the way first, at most `max`;
 * each place once (the same name a few metres apart, as tiles overlap).
 */
export function placesAlong<T extends LngLat & { name: string }>(
  tr: Track,
  places: T[],
  from: number,
  mode: Mode,
  max = ALONG_MAX,
): AlongHit<T>[] {
  const { band, reach } = ALONG[mode];
  const seen = new Set<string>();
  const once = places.filter((p) => {
    const key = `${p.name}|${p.lng.toFixed(4)}|${p.lat.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const hits: AlongHit<T>[] = [];
  // Snapped near the road only: hundreds of places, each onto the whole road, froze the app.
  snapNear(tr, once, band).forEach((s, i) => {
    const p = once[i];
    if (!s) return;
    const ahead = s.along - from;
    if (ahead < 0 || ahead > reach) return;
    const detour = s.offset < ON_THE_WAY_M ? 0 : (2 * s.offset) / DETOUR_MS[mode];
    hits.push({ it: p, ahead, off: s.offset, detour });
  });
  return hits.sort((a, b) => a.ahead - b.ahead).slice(0, max);
}
