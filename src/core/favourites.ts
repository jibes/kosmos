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
  /** The user's own name for it ("Home"); `name` stays the place's, to know it again. */
  label?: string;
  at: number;
}

export const FAVOURITES_MAX = 200;
/** The same place: its OSM id, or its name a few steps away (a label tapped again). */
const SAME_M = 50;

type Spot = Pick<Favourite, 'name' | 'lng' | 'lat' | 'osm' | 'label'> & { own?: string };
/**
 * A place opened from a renamed favourite carries the user's name, and the place's own (`own`)
 * for when the user's changes: any of them knows it.
 */
const sameName = (a: Spot, b: Spot) =>
  a.name === b.name ||
  (!!a.label && a.label === b.name) ||
  (!!b.label && b.label === a.name) ||
  (!!a.own && a.own === b.name) ||
  (!!b.own && b.own === a.name);

export const sameFavourite = (a: Spot, b: Spot) =>
  a.osm && b.osm ? a.osm === b.osm : sameName(a, b) && distance(a, b) <= SAME_M;

export const favouriteOf = (list: Favourite[], p: Spot) => list.find((f) => sameFavourite(f, p));
export const isFavourite = (list: Favourite[], p: Spot) => !!favouriteOf(list, p);

/** A name, not a note. */
export const LABEL_MAX = 60;

/** Its own name for a favourite; empty, or the place's own name, takes it off again. */
export function renameFavourite(list: Favourite[], p: Spot, label: string): Favourite[] {
  const name = label.trim().slice(0, LABEL_MAX);
  return list.map((f) => {
    if (!sameFavourite(f, p)) return f;
    const rest = { ...f };
    delete rest.label;
    return name && name !== f.name ? { ...rest, label: name } : rest;
  });
}

/** What a favourite is called: the user's name for it, else the place's. */
export const titleOf = (f: Pick<Favourite, 'name' | 'label'>) => f.label ?? f.name;

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

/**
 * A favourite starred before its card's lookup came: the address and OSM id it lacks, from
 * that place now. Nothing it has is changed, but for the name of the one starred (`was`) when
 * the lookup named the place (a dropped pin, by what is there).
 */
export function completeFavourite(
  list: Favourite[],
  p: Pick<Favourite, 'name' | 'lng' | 'lat' | 'detail' | 'osm'>,
  was?: Favourite,
): Favourite[] {
  return list.map((f) => {
    const renamed = f === was && !sameFavourite(f, p) && distance(f, p) <= SAME_M;
    if (!renamed && !sameFavourite(f, p)) return f;
    if (!renamed && !((!f.detail && p.detail) || (!f.osm && p.osm))) return f;
    return {
      ...f,
      ...(renamed ? { name: p.name } : {}),
      detail: f.detail || p.detail,
      ...(f.osm || !p.osm ? {} : { osm: p.osm }),
    };
  });
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
          typeof f.at === 'number' &&
          (f.label === undefined || typeof f.label === 'string') &&
          (f.osm === undefined || typeof f.osm === 'string') &&
          (f.kind === undefined || typeof f.kind === 'string') &&
          (f.stop === undefined || typeof f.stop === 'boolean'),
      )
      .map((f) =>
        f.label && f.label.length > LABEL_MAX ? { ...f, label: f.label.slice(0, LABEL_MAX) } : f,
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
      properties: { name: titleOf(f), fav: i },
    })),
  };
}

/**
 * Favourites from a backup added to those there are: the same place is kept as it is here,
 * and none here makes way for one restored (the newest restored first while there is room).
 */
export function mergeFavourites(here: Favourite[], restored: Favourite[]): Favourite[] {
  const added = restored
    .filter((r) => !here.some((f) => sameFavourite(f, r)))
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(0, FAVOURITES_MAX - here.length));
  return [...here, ...added].sort((a, b) => b.at - a.at);
}
