import { distance, type LngLat } from './geo';
import { fold } from './categories';
import { isStopOsm } from './departures';
import { kindOfOsm, type PlaceKind } from './placeKind';

/** Photon: OSM search built for search-as-you-type, unlike Nominatim's usage policy. */
export const PHOTON_URL = 'https://photon.komoot.io';
const PHOTON_LANGS = new Set(['en', 'de', 'fr', 'it']);

export interface Place extends LngLat {
  name: string;
  /** Address or context line, e.g. `Mitte, Berlin, Germany`. */
  detail: string;
  /** [west, south, east, north], when the place has an area worth fitting. */
  bbox?: [number, number, number, number];
  /** Metres from where the search looked, for places found by category. */
  distance?: number;
  /** A place without a name of its own (a toilet, a cash machine): called by its kind. */
  unnamed?: boolean;
  /** Found outside the view: none of its kind was in it, so the nearest around it. */
  beyond?: boolean;
  /** A stop or station: its card shows the next departures. */
  stop?: boolean;
  /** The user's own position, taken as a route's destination by swapping its ends. */
  here?: boolean;
  /** What it is, for the icon on its row (a station, a café, a street). */
  kind?: PlaceKind;
  /** The OSM object (`N123`, `W456`), when the search knows it; details are looked up by it. */
  osm?: string;
  /** Opened from a favourite by the user's name for it: the place's own, to know it again. */
  own?: string;
  /** One of the user's contacts: its link into the phone's address book, to open it there. */
  contact?: string;
}

export interface SearchBias extends LngLat {
  zoom: number;
}

/**
 * Kinds of place the map's tiles do not list, which people look for by their kind alone: the
 * whole query naming one asks Photon for those only, so "Flughafen" finds airports, not every
 * Flughafenstrasse and bus stop of that name first.
 */
const WORLD_KINDS: Record<string, string> = Object.fromEntries(
  [
    'flughafen',
    'airport',
    'airports',
    'flugplatz',
    'airfield',
    'aerodrome',
    'aeroport',
    'aeroporto',
    'aeropuerto',
  ].map((w) => [w, 'aeroway:aerodrome']),
);

/** The OSM tag to search for alone, when the query is the word for such a kind. */
export const worldKind = (query: string): string | undefined => WORLD_KINDS[fold(query).trim()];

/** Enough names to scroll through: a short word matches many places. */
const LIMIT = 15;

export function searchUrl(query: string, lang: string, bias?: SearchBias, limit = LIMIT): string {
  const q = new URLSearchParams({ q: query.trim(), limit: String(limit) });
  const tag = worldKind(query);
  if (tag) q.set('osm_tag', tag);
  if (PHOTON_LANGS.has(lang)) q.set('lang', lang);
  if (bias) {
    q.set('lat', bias.lat.toFixed(4));
    q.set('lon', bias.lng.toFixed(4));
    // Photon's default favours nearby results too strongly when zoomed out to the planet.
    q.set('zoom', String(Math.max(2, Math.min(18, Math.round(bias.zoom)))));
    q.set('location_bias_scale', '0.3');
  }
  return `${PHOTON_URL}/api/?${q}`;
}

export function reverseUrl({ lng, lat }: LngLat, lang: string): string {
  const q = new URLSearchParams({ lat: lat.toFixed(6), lon: lng.toFixed(6), limit: '1' });
  if (PHOTON_LANGS.has(lang)) q.set('lang', lang);
  return `${PHOTON_URL}/reverse?${q}`;
}

interface PhotonProps {
  name?: string;
  /** What the object is to Photon: `house`, `street`, `city`, … */
  type?: string;
  osm_type?: string;
  osm_id?: number;
  osm_key?: string;
  osm_value?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  locality?: string;
  district?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
  extent?: [number, number, number, number];
}

interface PhotonFeature {
  geometry?: { type?: string; coordinates?: [number, number] };
  properties?: PhotonProps;
}

const join = (parts: (string | undefined)[]) =>
  parts.filter((p, i, a): p is string => !!p && a.indexOf(p) === i).join(', ');

function toPlace(f: PhotonFeature): Place | null {
  const c = f.geometry?.coordinates;
  const p = f.properties ?? {};
  if (!c || c.length < 2 || !c.every(Number.isFinite)) return null;
  const street = p.street ? join([p.street + (p.housenumber ? ` ${p.housenumber}` : '')]) : '';
  const name = p.name ?? (street || p.city || p.state || p.country);
  if (!name) return null;
  const detail = join([
    street !== name ? street : undefined,
    p.district ?? p.locality,
    p.city !== name ? p.city : undefined,
    p.state !== name && p.state !== p.city ? p.state : undefined,
    p.country !== name ? p.country : undefined,
  ]);
  const place: Place = { name, detail, lng: c[0], lat: c[1] };
  if (p.osm_type && /^[NWR]$/.test(p.osm_type) && Number.isInteger(p.osm_id)) {
    place.osm = `${p.osm_type}${p.osm_id}`;
  }
  if (isStopOsm(p.osm_key, p.osm_value)) place.stop = true;
  place.kind = kindOfOsm(p.osm_key, p.osm_value, p.type);
  if (p.extent?.length === 4 && p.extent.every(Number.isFinite)) {
    // Photon's extent is [minLon, maxLat, maxLon, minLat].
    const [w, n, e, s] = p.extent;
    place.bbox = [w, s, e, n];
  }
  return place;
}

/** Parses a Photon GeoJSON response, dropping duplicates (same name and spot). */
export function parsePhoton(json: unknown): Place[] {
  const features = (json as { features?: PhotonFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const f of features) {
    const place = toPlace(f);
    if (!place) continue;
    const key = `${place.name}|${place.lat.toFixed(3)}|${place.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out;
}

/**
 * The hit nearest a point, within `radius` metres: the place a map label or a category result
 * stands for, not another of the same name (a chain's other branch) further away.
 */
export function nearestWithin(hits: Place[], at: LngLat, radius: number): Place | undefined {
  let best: Place | undefined;
  let bestM = radius;
  for (const h of hits) {
    const m = distance(h, at);
    if (m <= bestM) [best, bestM] = [h, m];
  }
  return best;
}

/**
 * The address line of a reverse lookup, whatever object it found there: street and number,
 * district, city, country. Never the name of a nearby place, which may be another one.
 */
export function parseAddress(json: unknown): string | null {
  const p = (json as { features?: PhotonFeature[] } | null)?.features?.[0]?.properties;
  if (!p) return null;
  const road = p.street ?? (p.type === 'street' ? p.name : undefined);
  const line = join([
    road && (p.housenumber ? `${road} ${p.housenumber}` : road),
    p.district ?? p.locality,
    p.city,
    p.state !== p.city ? p.state : undefined,
    p.country,
  ]);
  return line || null;
}
