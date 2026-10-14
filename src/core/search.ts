import type { LngLat } from './geo';

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
}

export interface SearchBias extends LngLat {
  zoom: number;
}

export function searchUrl(query: string, lang: string, bias?: SearchBias, limit = 7): string {
  const q = new URLSearchParams({ q: query.trim(), limit: String(limit) });
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
