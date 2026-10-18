import { distance } from './geo';
import type { PlaceKind } from './placeKind';

/**
 * Places the user keeps, on the device only: starred on a place card, a tap away in the empty
 * search field, and marked on the map. Newest first.
 */
export interface Favourite {
  name: string;
  detail: string;
  lng: number;
  lat: number;
  osm?: string;
  kind?: PlaceKind;
  stop?: boolean;
  at: number;
}

export const FAVOURITES_MAX = 200;
/** The same place: its OSM id, or its name a few steps away (a label tapped again). */
const SAME_M = 50;

export const sameFavourite = (
  a: Pick<Favourite, 'name' | 'lng' | 'lat' | 'osm'>,
  b: Pick<Favourite, 'name' | 'lng' | 'lat' | 'osm'>,
) => (a.osm && b.osm ? a.osm === b.osm : a.name === b.name && distance(a, b) <= SAME_M);

export const isFavourite = (list: Favourite[], p: Parameters<typeof sameFavourite>[0]) =>
  list.some((f) => sameFavourite(f, p));

/** Starred now, or unstarred: the list with `p` added first or taken out. */
export function toggleFavourite(
  list: Favourite[],
  p: Omit<Favourite, 'at'> & { at?: number },
  now: number,
): Favourite[] {
  if (isFavourite(list, p)) return list.filter((f) => !sameFavourite(f, p));
  const { name, detail, lng, lat, osm, kind, stop } = p;
  const kept: Favourite = {
    name,
    detail,
    lng,
    lat,
    at: now,
    ...(osm ? { osm } : {}),
    ...(kind ? { kind } : {}),
    ...(stop ? { stop } : {}),
  };
  return [kept, ...list].slice(0, FAVOURITES_MAX);
}

/** What storage holds, anything malformed dropped. */
export function parseFavourites(raw: string | null): Favourite[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        (f): f is Favourite =>
          !!f &&
          typeof f.name === 'string' &&
          typeof f.detail === 'string' &&
          Number.isFinite(f.lng) &&
          Number.isFinite(f.lat) &&
          Math.abs(f.lat) <= 90 &&
          Math.abs(f.lng) <= 180 &&
          typeof f.at === 'number',
      )
      .slice(0, FAVOURITES_MAX);
  } catch {
    return [];
  }
}

/** The map's star layer: one point a favourite, its name and its place in the list. */
export function favouriteFeatures(list: Favourite[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: list.map((f, i) => ({
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: [f.lng, f.lat] },
      properties: { name: f.name, fav: i },
    })),
  };
}
