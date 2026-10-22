import type { LngLat } from './geo';

/**
 * A place handed to the app from elsewhere (a `geo:` link, a map link, a shared message):
 * a point when the text holds one, else words to search for. Google's short links
 * (maps.app.goo.gl) cannot be opened without asking Google, so their message's words are
 * searched instead; the name and address usually come with them.
 */
export type Shared =
  | { at: LngLat; zoom?: number; name?: string }
  | { query: string }
  /** An OSM object (`N123`, `W456`, `R789`) from an openstreetmap.org/node/… link. */
  | { osm: string };

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

/**
 * One coordinate written with degrees ("52°30'58.7\"N", "N 52° 30.978'", "52,5163° N"):
 * hemisphere letters before or after (German O for east), minutes and seconds optional.
 */
const DEG = String.raw`(\d{1,3}(?:[.,]\d+)?)\s*[°º˚]\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′’]\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|″|''|”))?)?`;
const SEP = String.raw`\s*[,;/]?\s*`;
/** Letters before each ("N 52° 30.978' E 13° 22.662'") or after each, or none. */
const DMS_PRE = new RegExp(String.raw`^([NSEWO])?\s*${DEG}${SEP}([NSEWO])?\s*${DEG}$`, 'i');
const DMS_POST = new RegExp(String.raw`^${DEG}\s*([NSEWO])?${SEP}${DEG}\s*([NSEWO])?$`, 'i');
/** Decimal degrees with hemisphere letters and no degree sign: "52.5163N 13.3777E". */
const HEMI = /^(\d{1,3}\.\d+)\s*([NS])\s*[,;/]?\s*(\d{1,3}\.\d+)\s*([EWO])$/i;

const num = (s: string | undefined) => (s ? Number(s.replace(',', '.')) : 0);

/** A point written in degrees, minutes and seconds, or with hemisphere letters; else null. */
export function degreesIn(text: string): LngLat | null {
  const t = text.trim();
  const h = HEMI.exec(t);
  if (h) {
    const lat = num(h[1]) * (/s/i.test(h[2]) ? -1 : 1);
    const lng = num(h[3]) * (/w/i.test(h[4]) ? -1 : 1);
    return point(lat, lng);
  }
  let parts: { hemi: string; d: string; min?: string; sec?: string }[];
  let m = DMS_PRE.exec(t);
  if (m) {
    parts = [
      { hemi: m[1] ?? '', d: m[2], min: m[3], sec: m[4] },
      { hemi: m[5] ?? '', d: m[6], min: m[7], sec: m[8] },
    ];
  } else if ((m = DMS_POST.exec(t))) {
    parts = [
      { hemi: m[4] ?? '', d: m[1], min: m[2], sec: m[3] },
      { hemi: m[8] ?? '', d: m[5], min: m[6], sec: m[7] },
    ];
  } else return null;
  // 60 minutes or seconds is not a coordinate.
  if (parts.some((p) => num(p.min) >= 60 || num(p.sec) >= 60)) return null;
  const [a, b] = parts.map((p) => {
    const hemi = p.hemi.toUpperCase();
    const value = num(p.d) + num(p.min) / 60 + num(p.sec) / 3600;
    return { hemi, value: /[SW]/.test(hemi) ? -value : value };
  });
  // Hemisphere letters say which is which; without them latitude comes first.
  const isLng = (p: { hemi: string }) => /[EWO]/.test(p.hemi);
  const [lat, lng] = isLng(a) && !isLng(b) ? [b, a] : [a, b];
  if (isLng(lat) || /[NS]/.test(lng.hemi)) return null;
  return point(lat.value, lng.value);
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
    if (there) return { at: there, ...(map ? { zoom: zoomOf(map[1]) } : {}) };
    // A node, way or relation's own page: the object itself, looked up by its id.
    const obj = /^\/(node|way|relation)\/(\d+)/.exec(u.pathname);
    return obj ? { osm: `${obj[1][0].toUpperCase()}${obj[2]}` } : null;
  }
  if (/(^|\.)google\.[a-z.]+$/.test(host) || host === 'maps.google.com') {
    // `/maps/place/Name/@lat,lng,17z/data=…!3dlat!4dlng`, `?q=lat,lng`, `?ll=lat,lng`. The
    // `@` pair is where Google's camera stood (shifted for its side panel); `!3d…!4d…` is the
    // place itself.
    const at = /@(-?[\d.]+),(-?[\d.]+)(?:,(\d+(?:\.\d+)?)z)?/.exec(u.pathname);
    const own = /!3d(-?[\d.]+)!4d(-?[\d.]+)/.exec(u.pathname);
    const name = /\/place\/([^/@]+)/.exec(u.pathname)?.[1];
    const where = own
      ? point(Number(own[1]), Number(own[2]))
      : at
        ? point(Number(at[1]), Number(at[2]))
        : pairIn(p.get('q') ?? p.get('ll'));
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
  const deg = degreesIn(words);
  if (deg) return { at: deg };
  const at = pairIn(words);
  if (at && words.replace(PAIR, '').replace(/[\s,;°NSEW]/gi, '') === '') return { at };
  return words.length >= 2 ? { query: words.slice(0, 200) } : null;
}
