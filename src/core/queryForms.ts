import type { LngLat } from './geo';

/**
 * More ways to say where: what a search text may be besides a name, and the forms to try when
 * the search server finds nothing for it as typed. Pure; the search asks the server.
 */

// --- Plus Codes (Open Location Code): open, decoded on the device, no server. ---

const OLC = '23456789CFGHJMPQRVWX';
const PAIR_RES = [20, 1, 0.05, 0.0025, 0.000125];
const GRID_ROWS = 5;
const GRID_COLS = 4;

/**
 * A Plus Code anywhere in the text ("9C5M8RJW+Q2", "8RJW+Q2 Dublin"), and the rest of it. A
 * short one always has two characters or more after the "+" ("Lidl 24+" is none).
 */
const C = '[23456789CFGHJMPQRVWX]';
const PLUS = new RegExp(`(?:^|\\s)(${C}{8}\\+${C}{0,7}|${C}{2,7}\\+${C}{2,7})(?=\\s|,|$)`, 'i');

/** The middle of a full code's area; null for a code that is not one. */
function decodeFull(code: string): LngLat | null {
  const c = code.toUpperCase().replace('+', '');
  if (c.length < 8 || (c.length % 2 === 1 && c.length < 10)) return null;
  let lat = -90;
  let lng = -180;
  let latRes = 0;
  let lngRes = 0;
  for (let i = 0; i < Math.min(10, c.length); i += 2) {
    const a = OLC.indexOf(c[i]);
    const b = OLC.indexOf(c[i + 1]);
    if (a < 0 || b < 0) return null;
    const res = PAIR_RES[i / 2];
    lat += a * res;
    lng += b * res;
    latRes = lngRes = res;
  }
  for (let i = 10; i < c.length; i++) {
    const d = OLC.indexOf(c[i]);
    if (d < 0) return null;
    latRes /= GRID_ROWS;
    lngRes /= GRID_COLS;
    lat += Math.floor(d / GRID_COLS) * latRes;
    lng += (d % GRID_COLS) * lngRes;
  }
  return { lat: lat + latRes / 2, lng: lng + lngRes / 2 };
}

/**
 * A Plus Code: a full one alone, or a short one ("8RJW+Q2") near `near` (where the map
 * looks, or a town named after it, found first by the caller). `null` when the text holds none.
 */
export function plusCode(text: string, near?: LngLat): { at: LngLat | null; rest: string } | null {
  const m = PLUS.exec(text);
  if (!m) return null;
  const code = m[1].toUpperCase();
  const rest = text
    .replace(m[0], ' ')
    .replace(/[\s,]+/g, ' ')
    .trim();
  const before = code.indexOf('+');
  if (before === 8) return { at: decodeFull(code), rest };
  if (before < 2 || before % 2 === 1) return null;
  if (!near) return { at: null, rest };
  // A short code drops the first digits; they are the reference's, to the nearest match.
  const res = PAIR_RES[(8 - before) / 2 - 1];
  const prefixLen = 8 - before;
  const refCode = encodeFull(near).slice(0, prefixLen);
  const at = decodeFull(refCode + code);
  if (!at) return { at: null, rest };
  const half = res / 2;
  let { lat, lng } = at;
  if (near.lat + half < lat && lat - res >= -90) lat -= res;
  else if (near.lat - half > lat && lat + res <= 90) lat += res;
  if (near.lng + half < lng) lng -= res;
  else if (near.lng - half > lng) lng += res;
  return { at: { lat, lng: ((lng + 540) % 360) - 180 }, rest };
}

/** The first 10 digits of a point's full code (about 14 m), for recovering short codes. */
function encodeFull({ lat, lng }: LngLat): string {
  let la = Math.min(89.9999999, Math.max(-90, lat)) + 90;
  let lo = (((lng + 180) % 360) + 360) % 360;
  let out = '';
  for (const res of PAIR_RES) {
    const a = Math.floor(la / res);
    const b = Math.floor(lo / res);
    la -= a * res;
    lo -= b * res;
    out += OLC[a] + OLC[b];
  }
  return out;
}

// --- Postcodes ---

/**
 * Postcodes written loosely ("d02x285", "sw1a1aa", "1012ab"): the form the search server knows,
 * and the part that names an area, to fall back to when the whole code finds nothing (Ireland's
 * Eircodes name single buildings and are rarely in OpenStreetMap; their routing key is a town
 * or district).
 */
export function postcodeOf(text: string): { code: string; area: string } | null {
  const raw = text.trim().toUpperCase();
  const c = raw.replace(/[\s-]/g, '');
  if (c.length > 8 || !/\d/.test(c) || /[^A-Z0-9]/.test(c)) return null;
  // Ireland: a routing key (letter, two digits; D6W) and a four-character unique identifier.
  let m = /^([AC-FHKNPRTV-Y]\d{2}|D6W)([AC-FHKNPRTV-Y0-9]{4})$/.exec(c);
  if (m) return { code: `${m[1]} ${m[2]}`, area: m[1] };
  // United Kingdom: outward code and a three-character inward code.
  m = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/.exec(c);
  if (m) return { code: `${m[1]} ${m[2]}`, area: m[1] };
  // Canada: A1A 1A1.
  m = /^([A-Z]\d[A-Z])(\d[A-Z]\d)$/.exec(c);
  if (m) return { code: `${m[1]} ${m[2]}`, area: m[1] };
  // The Netherlands: four digits, two letters.
  m = /^(\d{4})([A-Z]{2})$/.exec(c);
  if (m) return { code: `${m[1]} ${m[2]}`, area: m[1] };
  // Elsewhere written with a space or a dash between its parts (113 51, 1000-001): the first
  // part names the area. Both have a digit: "12 Main" is a house number, "Linie 12" a line.
  m = /^([A-Z0-9]{2,5})[\s-]([A-Z0-9]{2,4})$/.exec(raw);
  if (m && /\d/.test(m[1]) && /\d/.test(m[2])) return { code: `${m[1]} ${m[2]}`, area: m[1] };
  return null;
}

// --- Other forms of the same text ---

/**
 * What else to ask when the text as typed finds nothing, most alike first, each once: the
 * postcode as written properly and then its area, the house number on the other side of the
 * street ("12 Main Street" / "Main Street 12"), and without its last word (a misspelled town).
 */
export function otherForms(text: string): string[] {
  const q = text.trim().replace(/\s+/g, ' ');
  const out: string[] = [];
  const add = (s: string | undefined) => {
    const v = s?.trim().replace(/\s+/g, ' ');
    if (v && v.length >= 2 && v.toLowerCase() !== q.toLowerCase() && !out.includes(v)) out.push(v);
  };
  const post = postcodeOf(q);
  if (post) {
    add(post.code);
    add(post.area);
    return out;
  }
  // Punctuation people type and the server does not need.
  add(q.replace(/[.;:!?"“”„'’]+/g, ' ').replace(/\s*,\s*/g, ', '));
  const words = q.split(' ');
  const num = /^\d+[a-zA-Z]?$/;
  if (words.length >= 2 && num.test(words[0])) add([...words.slice(1), words[0]].join(' '));
  else if (words.length >= 2 && num.test(words.at(-1)!))
    add([words.at(-1)!, ...words.slice(0, -1)].join(' '));
  if (words.length >= 3) add(words.slice(0, -1).join(' '));
  return out.slice(0, 2);
}
