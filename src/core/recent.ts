import { distance, type LngLat } from './geo';
import type { PlaceKind } from './placeKind';
import { CATEGORY_IDS } from './categories';

const knownKind = (k: unknown) =>
  typeof k === 'string' && (/^found:./.test(k) || (CATEGORY_IDS as string[]).includes(k));

/**
 * What the user searched for and took, newest first, kept on the device only: a place found by
 * name, or a kind of place (or chain) searched on the map. Typing is the slow part on a phone;
 * the last few are a tap away when the field is empty.
 */
export type Recent =
  | {
      place: {
        name: string;
        detail: string;
        lng: number;
        lat: number;
        osm?: string;
        bbox?: [number, number, number, number];
        kind?: PlaceKind;
      };
      at: number;
    }
  | { kind: string; label: string; at: number };

export const RECENT_MAX = 8;
/** Older than this, a search is not "recent" any more. */
export const RECENT_DAYS = 30;
const DAY_MS = 86_400_000;
/** The same place again: a few steps apart counts as one. */
const SAME_M = 50;

const same = (a: Recent, b: Recent) =>
  'kind' in a
    ? 'kind' in b && a.kind === b.kind
    : 'place' in b && a.place.name === b.place.name && distance(a.place, b.place) <= SAME_M;

/** Those not too old, newest first. */
export const fresh = (list: Recent[], now: number) =>
  list.filter((r) => now - r.at <= RECENT_DAYS * DAY_MS).sort((a, b) => b.at - a.at);

/** The list with `r` first, once, at most `RECENT_MAX`. */
export function remember(list: Recent[], r: Recent, now: number): Recent[] {
  return [r, ...fresh(list, now).filter((x) => !same(x, r))].slice(0, RECENT_MAX);
}

type RecentPlace = Extract<Recent, { place: unknown }>['place'];

/**
 * A place as kept among the recent ones, or `null` for none worth finding again: the user's
 * own position, or a dropped pin with nothing but its point (`pinName` is what such a pin is
 * called); a pin whose address came is kept by it.
 */
export function recentPlaceOf(
  p: {
    name: string;
    detail: string;
    lng: number;
    lat: number;
    osm?: string;
    bbox?: [number, number, number, number];
    kind?: RecentPlace['kind'];
    here?: boolean;
  },
  pinName: string,
): RecentPlace | null {
  if (p.here) return null;
  const pin = p.name === pinName;
  const name = pin ? p.detail : p.name;
  if (!name.trim()) return null;
  return {
    name,
    detail: pin ? '' : p.detail,
    lng: p.lng,
    lat: p.lat,
    ...(p.osm ? { osm: p.osm } : {}),
    ...(p.bbox ? { bbox: p.bbox } : {}),
    ...(p.kind ? { kind: p.kind } : {}),
  };
}

export function forget(list: Recent[], r: Recent): Recent[] {
  return list.filter((x) => !same(x, r));
}

const isPoint = (p: unknown): p is LngLat =>
  !!p &&
  typeof (p as LngLat).lng === 'number' &&
  typeof (p as LngLat).lat === 'number' &&
  Number.isFinite((p as LngLat).lng) &&
  Number.isFinite((p as LngLat).lat);

/** The stored list, whatever the storage holds: anything malformed is dropped, never thrown. */
export function parseRecent(raw: string | null): Recent[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((r): r is Recent => {
        if (!r || typeof r !== 'object' || typeof r.at !== 'number') return false;
        // A kind of place an update renamed or dropped is forgotten, not shown blank.
        if ('kind' in r) return typeof r.label === 'string' && knownKind(r.kind);
        return (
          'place' in r &&
          isPoint(r.place) &&
          typeof r.place.name === 'string' &&
          typeof r.place.detail === 'string'
        );
      })
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}
