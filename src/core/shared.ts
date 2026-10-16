import type { LngLat } from './geo';

/**
 * A place handed to the app from elsewhere (a `geo:` link, a map link, a shared message):
 * a point when the text holds one, else words to search for. Google's short links
 * (maps.app.goo.gl) cannot be opened without asking Google, so their message's words are
 * searched instead; the name and address usually come with them.
 */
export type Shared = { at: LngLat; zoom?: number; name?: string } | { query: string };

const point = (lat: number, lng: number): LngLat | null =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180 &&
  !(lat === 0 && lng === 0)
    ? { lat, lng }
    : null;

const NUM = String.raw`-?\d{1,3}(?:\.\d+)?`;
/** "52.5163, 13.3777" or "52.5163,13.3777". */
const PAIR = new RegExp(String.raw`(${NUM})\s*,\s*(${NUM})`);

function pairIn(text: string | null | undefined): LngLat | null {
  const m = text ? PAIR.exec(text) : null;
  return m ? point(Number(m[1]), Number(m[2])) : null;
}

const zoomOf = (z: string | null | undefined) => {
  const n = Number(z);
  return Number.isFinite(n) && n > 0 && n <= 22 ? n : undefined;
};

/** `geo:lat,lng?z=…`, `geo:0,0?q=lat,lng(Name)` or `geo:0,0?q=an address`. */
function fromGeo(uri: string): Shared | null {
  const m = /^geo:([^?#]*)(?:\?([^#]*))?/i.exec(uri.trim());
  if (!m) return null;
  const params = new URLSearchParams(m[2] ?? '');
  const q = params.get('q');
  const zoom = zoomOf(params.get('z'));
  const label = q ? /\(([^)]+)\)\s*$/.exec(q)?.[1] : undefined;
  const fromQ = pairIn(q);
  const at = fromQ ?? pairIn(m[1].split(';')[0]);
  if (at) return { at, ...(zoom ? { zoom } : {}), ...(label ? { name: label } : {}) };
  return q?.trim() ? { query: q.trim() } : null;
}

/** OpenStreetMap, Google Maps, Apple Maps and OsmAnd links with a point in them. */
function fromUrl(u: URL): Shared | null {
  const host = u.hostname.replace(/^www\./, '');
  const p = u.searchParams;
  if (/(^|\.)openstreetmap\.org$/.test(host) || host === 'osm.org') {
    const at = point(Number(p.get('mlat')), Number(p.get('mlon')));
    const map = /map=(\d+(?:\.\d+)?)\/(-?[\d.]+)\/(-?[\d.]+)/.exec(u.hash);
    const there = at ?? (map ? point(Number(map[2]), Number(map[3])) : null);
    return there ? { at: there, ...(map ? { zoom: zoomOf(map[1]) } : {}) } : null;
  }
  if (/(^|\.)google\.[a-z.]+$/.test(host) || host === 'maps.google.com') {
    // `/maps/place/Name/@lat,lng,17z`, `?q=lat,lng`, `?ll=lat,lng`.
    const at = /@(-?[\d.]+),(-?[\d.]+)(?:,(\d+(?:\.\d+)?)z)?/.exec(u.pathname);
    const name = /\/place\/([^/@]+)/.exec(u.pathname)?.[1];
    const where = at ? point(Number(at[1]), Number(at[2])) : pairIn(p.get('q') ?? p.get('ll'));
    if (where) {
      return {
        at: where,
        ...(at?.[3] ? { zoom: zoomOf(at[3]) } : {}),
        ...(name ? { name: decodeURIComponent(name.replace(/\+/g, ' ')) } : {}),
      };
    }
    const q = p.get('q');
    return q?.trim() ? { query: q.trim() } : null;
  }
  if (host === 'maps.apple.com') {
    const where = pairIn(p.get('ll') ?? p.get('q'));
    const q = p.get('q') ?? undefined;
    if (where) return { at: where, ...(q && !pairIn(q) ? { name: q } : {}) };
    return q?.trim() ? { query: q.trim() } : null;
  }
  if (host === 'osmand.net') {
    const where = point(Number(p.get('lat')), Number(p.get('lon')));
    return where ? { at: where, ...(p.get('z') ? { zoom: zoomOf(p.get('z')) } : {}) } : null;
  }
  return null;
}

const URL_RE = /\bhttps?:\/\/\S+/gi;

/**
 * What a shared link or message points at: the first link or `geo:` URI that holds a place,
 * else coordinates in the text, else the text itself (without its links) to search for.
 */
export function parseShared(text: string): Shared | null {
  const t = text.trim();
  if (!t) return null;
  // A whole geo: URI may have spaces in its label ("(Brandenburger Tor)"); one in a message
  // ends at the first space.
  if (/^geo:/i.test(t)) return fromGeo(t);
  const geo = /geo:\S+/i.exec(t)?.[0];
  if (geo) {
    const g = fromGeo(geo);
    if (g) return g;
  }
  for (const link of t.match(URL_RE) ?? []) {
    try {
      const s = fromUrl(new URL(link));
      if (s) return s;
    } catch {
      // Not a link after all.
    }
  }
  const words = t.replace(URL_RE, ' ').replace(/\s+/g, ' ').trim();
  const at = pairIn(words);
  if (at && words.replace(PAIR, '').replace(/[\s,;°NSEW]/gi, '') === '') return { at };
  return words.length >= 2 ? { query: words.slice(0, 200) } : null;
}
