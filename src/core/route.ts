import { boundsOfLine, type LngLat } from './geo';
import { parseLanes, type Lane } from './lanes';
import type { Transit } from './transit';

/** Valhalla on FOSSGIS: the router behind openstreetmap.org's directions. Fair use, no key. */
export const ROUTER_URL = 'https://valhalla1.openstreetmap.de';

/** Ways the router finds along roads and paths; these can be navigated turn by turn. */
export type Mode = 'car' | 'bike' | 'foot';
export const MODES: readonly Mode[] = ['car', 'bike', 'foot'];
/** What the route card offers: the road modes, and public transport from Transitous. */
export type TravelMode = Mode | 'transit';

/** The way of travel road guidance uses; public transport walks are guided by the ride. */
export const roadModeOf = (trip: { mode: TravelMode } | null | undefined): Mode =>
  trip && trip.mode !== 'transit' ? trip.mode : 'car';
export const TRAVEL_MODES: readonly TravelMode[] = [...MODES, 'transit'];
const COSTING: Record<Mode, string> = { car: 'auto', bike: 'bicycle', foot: 'pedestrian' };

/**
 * On foot, Valhalla's defaults cost a four-lane road like a footpath. Footways and paths (also
 * the sidewalks mapped beside a big road) count 40 % cheaper, roads with a sidewalk 20 %, so a
 * walk keeps to them unless the detour is long.
 */
const FOOT_OPTIONS = { pedestrian: { walkway_factor: 0.6, sidewalk_factor: 0.8 } };

/**
 * By bike, `use_roads` below Valhalla's 0.5 favours cycleways and quiet streets over busy
 * roads, at the cost of a somewhat longer ride.
 */
const BIKE_OPTIONS = { bicycle: { use_roads: 0.25 } };

const OPTIONS: Partial<Record<Mode, object>> = { foot: FOOT_OPTIONS, bike: BIKE_OPTIONS };

/** Languages Valhalla writes instructions in; anything else falls back to English. */
const LANGS = new Set(
  'bg ca cs da de el en es et fi fr hi hu it ja nb nl pl pt ro ru sk sl sv tr uk'.split(' '),
);

export interface Maneuver {
  /** Valhalla maneuver type, 0–38. */
  type: number;
  instruction: string;
  /** Spoken well ahead: "In 400 metres, turn right onto …" comes from distance + this. */
  alert?: string;
  /** Spoken just before the maneuver. */
  pre?: string;
  /** Spoken just after it: "Continue for 2 kilometres." */
  post?: string;
  street?: string;
  /** Metres from this maneuver to the next. */
  distance: number;
  /** Seconds from this maneuver to the next. */
  duration: number;
  /** Index into `Route.coords` where the maneuver happens. */
  begin: number;
  exit?: number;
  /** Where the signs at this maneuver point ("Tullamore / Dublin"), from OSM destinations. */
  toward?: string;
  /** Route numbers on the signs ("N52"), from OSM `destination:ref`: what to look out for. */
  refs?: string;
  /** A motorway junction's number on its sign ("12", "14a"), from OSM `junction:ref`. */
  junction?: string;
  /** Where it leads in words ("towards Tullamore"; a roundabout also "heading north"). */
  wayOut?: string;
  /** Lanes approaching this maneuver, left to right, when the router knows them. */
  lanes?: Lane[];
  /** Arriving at a stop on the way, not the end: which of the request's stops, from 0. */
  stop?: number;
  /** That stop among the trip's own (`Trip.via`), once named for it. */
  via?: number;
}

export interface Route {
  /** [lng, lat] pairs. */
  coords: [number, number][];
  /** Metres. */
  distance: number;
  /** Seconds. */
  duration: number;
  maneuvers: Maneuver[];
  /** [west, south, east, north]. */
  bbox: [number, number, number, number];
  /** Set for public transport: legs and timetable. Such routes have no maneuvers. */
  transit?: Transit;
  /** Part of it is a toll road (Valhalla's summary says so). */
  toll?: boolean;
}

export function routeUrl(
  /** With `heading`, the direction of travel at the start (a reroute while driving). */
  from: LngLat & { heading?: number | null },
  to: LngLat,
  mode: Mode,
  lang: string,
  alternates = 2,
  units: Units = 'metric',
  /**
   * By car: no toll roads. `use_tolls` 0 alone is only a preference (a toll motorway can still
   * win), so `exclude_tolls` forbids them; with no way around, there is none.
   */
  avoidTolls = false,
  /** Stops on the way, in order: the route arrives at each and sets off again. */
  via: readonly LngLat[] = [],
) {
  const options =
    mode === 'car' && avoidTolls
      ? { auto: { use_tolls: 0, exclude_tolls: true } }
      : (OPTIONS[mode] ?? null);
  const body = {
    locations: [
      {
        lat: +from.lat.toFixed(6),
        lon: +from.lng.toFixed(6),
        // So a new route carries on the way the car is going instead of starting by turning round.
        ...(from.heading != null && Number.isFinite(from.heading)
          ? { heading: Math.round(((from.heading % 360) + 360) % 360), heading_tolerance: 45 }
          : {}),
      },
      ...via.map((v) => ({ lat: +v.lat.toFixed(6), lon: +v.lng.toFixed(6) })),
      { lat: +to.lat.toFixed(6), lon: +to.lng.toFixed(6) },
    ],
    costing: COSTING[mode],
    ...(options ? { costing_options: options } : {}),
    directions_options: {
      // The router's own words ("Continue for 2 miles") in the units the app shows.
      units: units === 'metric' ? 'kilometers' : 'miles',
      language: LANGS.has(lang) ? lang : 'en',
    },
    // Other ways only between two ends: the router finds none past stops.
    alternates: via.length ? 0 : alternates,
    turn_lanes: true,
  };
  // GET keeps the request "simple" for CORS: no preflight.
  return `${ROUTER_URL}/route?json=${encodeURIComponent(JSON.stringify(body))}`;
}

/** Google's encoded polyline, at Valhalla's precision of 6, to [lng, lat] pairs. */
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

/** The inverse of `decodePolyline`; used by tests and fixtures. */
export function encodePolyline(coords: [number, number][], precision = 6): string {
  const factor = 10 ** precision;
  let out = '';
  let pLat = 0;
  let pLng = 0;
  const put = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    while (x >= 0x20) {
      out += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
      x >>= 5;
    }
    out += String.fromCharCode(x + 63);
  };
  for (const [lng, lat] of coords) {
    const la = Math.round(lat * factor);
    const lo = Math.round(lng * factor);
    put(la - pLat);
    put(lo - pLng);
    pLat = la;
    pLng = lo;
  }
  return out;
}

interface VManeuver {
  type?: number;
  instruction?: string;
  verbal_transition_alert_instruction?: string;
  verbal_succinct_transition_instruction?: string;
  verbal_pre_transition_instruction?: string;
  verbal_post_transition_instruction?: string;
  street_names?: string[];
  length?: number;
  time?: number;
  begin_shape_index?: number;
  roundabout_exit_count?: number;
  lanes?: unknown;
  sign?: {
    exit_toward_elements?: VSign[];
    exit_branch_elements?: VSign[];
    exit_number_elements?: VSign[];
  };
}
interface VSign {
  text?: string;
  is_route_number?: boolean;
}
interface VTrip {
  /** What `length` is counted in: the unit asked for in `directions_options`. */
  units?: string;
  legs?: { shape?: string; maneuvers?: VManeuver[] }[];
  summary?: { length?: number; time?: number; has_toll?: boolean };
}

const texts = (es: VSign[] | undefined, numbers: boolean) => [
  ...new Set(
    (es ?? [])
      .filter((e) => !!e.is_route_number === numbers)
      .map((e) => e.text?.trim())
      .filter((x): x is string => !!x),
  ),
];
const joined = (xs: string[]) => xs.join(' / ') || undefined;

/** The places a maneuver's signs point to, as they read: "Tullamore / Dublin". */
const towardOf = (m: VManeuver) => joined(texts(m.sign?.exit_toward_elements, false));

/** The route numbers on its signs, the branch's before those further on: "N52 / M6". */
const refsOf = (m: VManeuver) =>
  joined([
    ...new Set([
      ...texts(m.sign?.exit_branch_elements, true),
      ...texts(m.sign?.exit_toward_elements, true),
    ]),
  ]);

/** A road number rather than a name: "R148", "A 5", "N52a". */
const REF = /^[A-Z]{1,3}[ -]?\d{1,4}[A-Za-z]?$/;

/**
 * The road as the signs show it. A number on the sign wins over the road's own, which may
 * be one the signs never carried (Ireland's old national roads are regional now, the signs
 * often not); a name keeps the sign's number after it.
 */
export function roadOf(m: Pick<Maneuver, 'street' | 'refs'>): string | undefined {
  if (!m.refs) return m.street;
  if (!m.street || REF.test(m.street) || m.refs.split(' / ').includes(m.street)) return m.refs;
  return `${m.street} · ${m.refs}`;
}

function toRoute(trip: VTrip | undefined): Route | null {
  if (!trip?.legs?.length) return null;
  // Lengths come in the unit the request named: miles where the app shows miles.
  const metres = trip.units === 'miles' ? 1609.344 : 1000;
  const coords: [number, number][] = [];
  const maneuvers: Maneuver[] = [];
  const legs = trip.legs;
  for (const [li, leg] of legs.entries()) {
    // Legs share their joining point; drop the duplicate.
    const offset = coords.length ? coords.length - 1 : 0;
    const shape = decodePolyline(leg.shape ?? '');
    coords.push(...(coords.length ? shape.slice(1) : shape));
    const ms = leg.maneuvers ?? [];
    for (const [mi, m] of ms.entries()) {
      // A leg that ends before the last ends at a stop on the way.
      const stop = li < legs.length - 1 && mi === ms.length - 1 ? li : undefined;
      maneuvers.push({
        type: m.type ?? 0,
        instruction: m.instruction ?? '',
        alert: m.verbal_transition_alert_instruction ?? m.verbal_succinct_transition_instruction,
        pre: m.verbal_pre_transition_instruction,
        post: m.verbal_post_transition_instruction,
        street: m.street_names?.[0],
        distance: (m.length ?? 0) * metres,
        duration: m.time ?? 0,
        begin: offset + (m.begin_shape_index ?? 0),
        exit: m.roundabout_exit_count,
        toward: towardOf(m),
        refs: refsOf(m),
        junction: joined(texts(m.sign?.exit_number_elements, false)),
        lanes: parseLanes(m.lanes),
        ...(stop !== undefined ? { stop } : {}),
      });
    }
  }
  if (coords.length < 2) return null;
  const [w, s, e, n] = boundsOfLine(coords);
  return {
    coords,
    distance: (trip.summary?.length ?? 0) * metres,
    duration: trip.summary?.time ?? 0,
    maneuvers,
    bbox: [w, s, e, n],
    ...(trip.summary?.has_toll ? { toll: true } : {}),
  };
}

/** Every way found has toll roads: a toll-free one is worth asking for. */
export const needsTollFree = (routes: Route[]) => routes.length > 0 && routes.every((r) => r.toll);

/** The routes found, then the toll-free one, unless the router gave one with tolls anyway. */
export const withTollFree = (routes: Route[], free: Route[]) =>
  free[0] && !free[0].toll ? [...routes, free[0]] : routes;

/** The main route first, then any alternates. */
export function parseValhalla(json: unknown): Route[] {
  const r = json as { trip?: VTrip; alternates?: { trip?: VTrip }[] } | null;
  return [r?.trip, ...(r?.alternates ?? []).map((a) => a.trip)]
    .map(toRoute)
    .filter((x): x is Route => !!x);
}

export type RouteError = 'none' | 'busy' | 'failed';

/** Valhalla answers "no route" with HTTP 400; the public server says "busy" with 429. */
export function classifyError(status: number): RouteError {
  if (status === 429 || status === 503) return 'busy';
  if (status === 400 || status === 404) return 'none';
  return 'failed';
}

/**
 * Road distances by country: metric almost everywhere; miles with feet in the US (also Liberia,
 * Myanmar), miles with yards in the UK.
 */
export type Units = 'metric' | 'us' | 'uk';

export function unitsFor(locale: string): Units {
  const region = locale.split(/[-_]/)[1]?.toUpperCase();
  if (region === 'US' || region === 'LR' || region === 'MM') return 'us';
  if (region === 'GB') return 'uk';
  return 'metric';
}

const MILE = 1609.344;
const FOOT = 0.3048;
const YARD = 0.9144;

/** `850 m`, `4.2 km`, `37 km`; `500 ft`, `0.3 mi`; `300 yd`. */
export function formatDistance(m: number, lang: string, units: Units = 'metric'): string {
  const nf = (v: number, d: number) =>
    v.toLocaleString(lang, { maximumFractionDigits: d, minimumFractionDigits: d });
  if (units !== 'metric') {
    if (m < MILE / 10) {
      const [size, unit] = units === 'us' ? [FOOT, 'ft'] : [YARD, 'yd'];
      const v = m / size;
      const step = v < 300 ? 10 : 50;
      // Never more than 0.1 mi says just after (176 yd, 528 ft): a countdown never goes up.
      const most = units === 'us' ? 500 : 170;
      return `${Math.min(most, Math.max(0, Math.round(v / step) * step))} ${unit}`;
    }
    // Where rounding would reach the next step ("10.0 mi"), the next step's way of saying it.
    return `${nf(m / MILE, m < 9.95 * MILE ? 1 : 0)} mi`;
  }
  if (m < 50) return `${Math.max(0, Math.round(m / 5) * 5)} m`;
  // 995 m is "1.0 km", not "1000 m"; 9.96 km is "10 km", not "10.0 km".
  if (m < 995) return `${Math.round(m / 10) * 10} m`;
  return m < 9950 ? `${nf(m / 1000, 1)} km` : `${nf(m / 1000, 0)} km`;
}

export type SpokenUnit = 'm' | 'km' | 'ft' | 'yd' | 'mi';

/**
 * A distance as people say it ahead of a turn: tens of metres when close, fifties below a
 * kilometre, kilometres with one decimal beyond (feet or yards, then miles, where those are used).
 */
export function spokenDistance(
  m: number,
  units: Units = 'metric',
): { value: number; unit: SpokenUnit } {
  if (units !== 'metric') {
    if (m < MILE / 10) {
      const [size, unit] = units === 'us' ? [FOOT, 'ft' as const] : [YARD, 'yd' as const];
      const most = units === 'us' ? 500 : 150;
      return { value: Math.min(most, Math.max(50, Math.round(m / size / 50) * 50)), unit };
    }
    return { value: Math.round((m / MILE) * 10) / 10, unit: 'mi' };
  }
  if (m < 200) return { value: Math.max(10, Math.round(m / 10) * 10), unit: 'm' };
  if (m < 950) return { value: Math.round(m / 50) * 50, unit: 'm' };
  return { value: Math.round(m / 100) / 10, unit: 'km' };
}

/** Speed in the country's road unit. */
export const speedIn = (mps: number, units: Units) =>
  Math.round(units === 'metric' ? mps * 3.6 : mps * 2.236936);
export const speedLabel = (units: Units) => (units === 'metric' ? 'km/h' : 'mph');

/** `1 min`, `42 min`, `2 h 05`. */
export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

/** Whether a locale reads the time on a 12-hour clock, cached: asked for every time shown. */
const twelve = new Map<string, boolean>();
const isTwelve = (lang: string) => {
  let h = twelve.get(lang);
  if (h === undefined) {
    const cycle = new Intl.DateTimeFormat(lang, { hour: 'numeric' }).resolvedOptions().hourCycle;
    h = cycle === 'h11' || cycle === 'h12';
    twelve.set(lang, h);
  }
  return h;
};

/** "06:05" on a 24-hour clock, as timetables write it; "6:05 AM" on a 12-hour one. */
export function formatClock(date: Date, lang: string): string {
  return date.toLocaleTimeString(lang, {
    hour: isTwelve(lang) ? 'numeric' : '2-digit',
    minute: '2-digit',
  });
}

export type Turn =
  | 'straight'
  | 'slight-right'
  | 'right'
  | 'sharp-right'
  | 'uturn'
  | 'sharp-left'
  | 'left'
  | 'slight-left'
  | 'roundabout'
  | 'arrive'
  | 'depart'
  | 'ferry';

/** Turns the arrow says all about: becomes, continue, left/right, U-turn, merge. */
const PLAIN_TURNS = new Set([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 37, 38]);

/**
 * The banner's line for a maneuver, read at a glance: the street for a plain turn (the arrow
 * shows which way, and the street is what the signs say), else the router's sentence without
 * its full stop. Speech and screen readers keep the whole sentence.
 */
export function bannerText(m: Pick<Maneuver, 'type' | 'instruction' | 'street' | 'refs'>): string {
  const road = roadOf(m);
  if (road && PLAIN_TURNS.has(m.type)) return road;
  return m.instruction.replace(/\.$/, '');
}

/** Collapses Valhalla's 39 maneuver types into the dozen arrows a person reads. */
export function turnOf(type: number): Turn {
  switch (type) {
    case 1:
    case 2:
    case 3:
      return 'depart';
    case 4:
    case 5:
    case 6:
      return 'arrive';
    case 9:
    case 18:
    case 20:
    case 23:
    case 37:
      return 'slight-right';
    case 10:
      return 'right';
    case 11:
      return 'sharp-right';
    case 12:
    case 13:
      return 'uturn';
    case 14:
      return 'sharp-left';
    case 15:
      return 'left';
    case 16:
    case 19:
    case 21:
    case 24:
    case 38:
      return 'slight-left';
    case 26:
    case 27:
      return 'roundabout';
    case 28:
    case 29:
      return 'ferry';
    default:
      return 'straight';
  }
}
