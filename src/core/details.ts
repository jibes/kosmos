/**
 * What OpenStreetMap knows about a place beyond its name and address: opening hours, phone,
 * website. From Nominatim (OSM Foundation), one lookup per place card, by the place's OSM id;
 * its policy allows that, at most once a second, from an app that names itself.
 */
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';

export interface Details {
  /** Raw `opening_hours`. */
  hours?: string;
  phone?: string;
  website?: string;
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

/** Websites without the scheme read better; links still need it. */
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
  return out;
}
