import { photoRefOf, type PhotoRef } from './photo';

/**
 * What OpenStreetMap knows about a place beyond its name and address: opening hours, phone,
 * website, where its photo is. From Nominatim (OSM Foundation), one lookup per place card, by the place's OSM id;
 * its policy allows that, at most once a second, from an app that names itself.
 */
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';

export interface Details {
  /** Raw `opening_hours`. */
  hours?: string;
  phone?: string;
  website?: string;
  /** A photo on Wikimedia Commons, by file or Wikidata item. */
  photo?: PhotoRef;
}

/** `N123`, `W456`, `R789`: an OSM object, as Photon and Nominatim both name them. */
export const isOsmId = (id: string) => /^[NWR]\d+$/.test(id);

export function lookupUrl(osm: string, lang: string): string {
  const q = new URLSearchParams({
    osm_ids: osm,
    format: 'jsonv2',
    extratags: '1',
    addressdetails: '0',
    'accept-language': lang,
  });
  return `${NOMINATIM_URL}/lookup?${q}`;
}

/** Where a looked-up object is and what it is called: an OSM link opened from elsewhere. */
export function parseLookupPlace(
  json: unknown,
): { lng: number; lat: number; name?: string; detail: string } | null {
  const o = (
    json as { lat?: string; lon?: string; name?: string; display_name?: string }[] | null
  )?.[0];
  const lat = Number(o?.lat);
  const lng = Number(o?.lon);
  if (!o || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = o.name?.trim() || undefined;
  // The rest of its display name: where it is.
  const parts = (o.display_name ?? '').split(', ');
  const detail = (name && parts[0] === name ? parts.slice(1) : parts).slice(0, 3).join(', ');
  return { lng, lat, ...(name ? { name } : {}), detail };
}

/** Websites without the scheme read better; links still need it. */
/**
 * A phone number as a `tel:` link: the first of several (`;`), digits and the leading plus
 * only, without the trunk "(0)" written after the country code ("+49 (0)30 …").
 */
export const telOf = (phone: string) => {
  const first = phone.split(';')[0].trim();
  const intl = first.startsWith('+') ? first.replace(/\(0\)/g, '') : first;
  return `tel:${intl.replace(/[^\d+]/g, '')}`;
};

export const withScheme = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

export function parseLookup(json: unknown): Details {
  const tags = (json as { extratags?: Record<string, string> | null }[] | null)?.[0]?.extratags;
  if (!tags) return {};
  const first = (...keys: string[]) => {
    for (const k of keys) {
      // Several values are separated by ";"; the first is what a card needs.
      const v = tags[k]?.split(';')[0].trim();
      if (v) return v;
    }
    return undefined;
  };
  const out: Details = {};
  const hours = tags.opening_hours?.trim();
  const phone = first('phone', 'contact:phone');
  const website = first('website', 'contact:website', 'url');
  if (hours) out.hours = hours;
  if (phone) out.phone = phone;
  if (website && /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}/i.test(website)) out.website = website;
  const photo = photoRefOf(tags);
  if (photo) out.photo = photo;
  return out;
}

/**
 * A finished query to Nominatim's search, for when Photon does not answer. Never as-you-type:
 * the OSMF policy forbids that; one request per query the user settled on is fine.
 */
export function nominatimSearchUrl(
  query: string,
  lang: string,
  near?: { lng: number; lat: number; zoom: number },
): string {
  const q = new URLSearchParams({
    q: query.trim(),
    format: 'jsonv2',
    limit: '7',
    'accept-language': lang,
  });
  if (near) {
    // Prefer what is around the view, a few times its size, without excluding the rest.
    const d = Math.min(20, 360 / 2 ** Math.max(0, near.zoom - 1));
    q.set(
      'viewbox',
      [near.lng - d, near.lat + d / 2, near.lng + d, near.lat - d / 2]
        .map((v) => v.toFixed(4))
        .join(','),
    );
  }
  return `${NOMINATIM_URL}/search?${q}`;
}

interface NomPlace {
  name?: string;
  display_name?: string;
  lat?: string;
  lon?: string;
  osm_type?: string;
  osm_id?: number;
  boundingbox?: [string, string, string, string];
}

/** Nominatim search results as places: name, the rest of its address, OSM id, extent. */
export function parseNominatim(json: unknown): {
  name: string;
  detail: string;
  lng: number;
  lat: number;
  osm?: string;
  bbox?: [number, number, number, number];
}[] {
  if (!Array.isArray(json)) return [];
  return (json as NomPlace[]).flatMap((p) => {
    const lng = Number(p.lon);
    const lat = Number(p.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
    const parts = (p.display_name ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const name = p.name || parts[0];
    if (!name) return [];
    const detail = parts
      .filter((s) => s !== name)
      .slice(0, 4)
      .join(', ');
    const type = { node: 'N', way: 'W', relation: 'R' }[p.osm_type ?? ''];
    const [s, n, w, e] = (p.boundingbox ?? []).map(Number);
    return [
      {
        name,
        detail,
        lng,
        lat,
        ...(type && Number.isInteger(p.osm_id) ? { osm: `${type}${p.osm_id}` } : {}),
        ...([s, n, w, e].every(Number.isFinite)
          ? { bbox: [w, s, e, n] as [number, number, number, number] }
          : {}),
      },
    ];
  });
}
