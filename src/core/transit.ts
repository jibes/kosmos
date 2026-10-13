import { distance, type LngLat } from './geo';
import { decodePolyline, type Route } from './route';

/**
 * Public transport from Transitous: a community-run MOTIS instance with timetables from across
 * the world, free for open-source apps under fair use. Asked once per trip or departure time.
 */
export const TRANSIT_URL = 'https://api.transitous.org';

/** One stop or place where a leg begins or ends. */
export interface Stop {
  name: string;
  lng: number;
  lat: number;
  track?: string;
}

export interface TransitLeg {
  /** On a vehicle, as opposed to walking to, from or between stops. */
  ride: boolean;
  /** MOTIS mode: BUS, TRAM, SUBWAY, REGIONAL_RAIL, WALK, … */
  mode: string;
  from: Stop;
  to: Stop;
  /** Epoch milliseconds, with real-time data where there is any. */
  start: number;
  end: number;
  /** Minutes behind (positive) or ahead of the timetable at departure. */
  delay: number;
  /** "U6", "M10", "RE 1"; empty for walking. */
  line?: string;
  headsign?: string;
  /** `#rrggbb` from the timetable, when it has one. */
  color?: string;
  textColor?: string;
  /** Stops passed without getting off. */
  stops: number;
  /** Those stops in order, with arrival times (epoch ms) where the timetable has them. */
  via: (Stop & { arrival?: number })[];
  /** Metres. */
  distance: number;
  coords: [number, number][];
  cancelled: boolean;
}

export interface Transit {
  legs: TransitLeg[];
  start: number;
  end: number;
  transfers: number;
}

/** Leg modes that are not a vehicle someone else drives. */
const OWN_WAY = new Set(['WALK', 'BIKE', 'RENTAL', 'CAR', 'HGV', 'CAR_PARKING', 'CAR_DROPOFF']);

/**
 * `/api/v5/plan`: v5 (MOTIS 2.x since 2025) and later return polylines at precision 6, like
 * Valhalla. Without `at` the server plans from its own clock, which is the freshest "now".
 */
export function transitUrl(from: LngLat, to: LngLat, lang: string, at: number | null = null) {
  const p = new URLSearchParams({
    fromPlace: `${from.lat.toFixed(6)},${from.lng.toFixed(6)}`,
    toPlace: `${to.lat.toFixed(6)},${to.lng.toFixed(6)}`,
    language: lang,
  });
  if (at !== null) p.set('time', new Date(at).toISOString());
  return `${TRANSIT_URL}/api/v5/plan?${p}`;
}

/**
 * The departure a time field means: today at `hh:mm`, or tomorrow when that is more than ten
 * minutes gone already (typing 06:00 late at night means the morning).
 */
export function departureAt(hhmm: string, now: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date(now);
  d.setHours(+m[1], +m[2], 0, 0);
  if (d.getTime() < now - 10 * 60_000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** `hh:mm` in local time, for a time field. */
export function clockValue(time: number): string {
  const d = new Date(time);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const hex = (c: unknown) =>
  typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c)
    ? `#${c.replace('#', '').toLowerCase()}`
    : undefined;

/** Black or white, whichever reads better on a line colour (WCAG relative luminance). */
export function textOn(color: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#000000' : '#ffffff';
}

interface MPlace {
  name?: string;
  lat?: number;
  lon?: number;
  track?: string;
}
interface MLeg {
  mode?: string;
  from?: MPlace;
  to?: MPlace;
  startTime?: string;
  endTime?: string;
  scheduledStartTime?: string;
  displayName?: string;
  routeShortName?: string;
  headsign?: string;
  routeColor?: string;
  routeTextColor?: string;
  intermediateStops?: (MPlace & { arrival?: string })[];
  distance?: number;
  legGeometry?: { points?: string; precision?: number };
  cancelled?: boolean;
}
interface MItinerary {
  startTime?: string;
  endTime?: string;
  duration?: number;
  transfers?: number;
  legs?: MLeg[];
}

const stop = (p: MPlace | undefined): Stop => ({
  name: p?.name ?? '',
  lng: p?.lon ?? 0,
  lat: p?.lat ?? 0,
  ...(p?.track ? { track: p.track } : {}),
});

const length = (coords: [number, number][]) => {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]];
    m += distance({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
  }
  return m;
};

function toLeg(l: MLeg): TransitLeg | null {
  const start = Date.parse(l.startTime ?? '');
  const end = Date.parse(l.endTime ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const mode = l.mode ?? 'OTHER';
  const ride = !OWN_WAY.has(mode);
  const from = stop(l.from);
  const to = stop(l.to);
  const g = l.legGeometry;
  let coords = g?.points ? decodePolyline(g.points, g.precision ?? 6) : [];
  if (coords.length < 2)
    coords = [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ];
  const scheduled = Date.parse(l.scheduledStartTime ?? '');
  const color = ride ? hex(l.routeColor) : undefined;
  return {
    ride,
    mode,
    from,
    to,
    start,
    end,
    delay: Number.isFinite(scheduled) ? Math.round((start - scheduled) / 60_000) : 0,
    ...(ride ? { line: l.displayName || l.routeShortName || undefined } : {}),
    ...(ride && l.headsign ? { headsign: l.headsign } : {}),
    ...(color ? { color, textColor: hex(l.routeTextColor) ?? textOn(color) } : {}),
    stops: l.intermediateStops?.length ?? 0,
    via: (l.intermediateStops ?? []).map((v) => {
      const arrival = Date.parse(v?.arrival ?? '');
      return { ...stop(v), ...(Number.isFinite(arrival) ? { arrival } : {}) };
    }),
    distance: l.distance ?? length(coords),
    coords,
    cancelled: !!l.cancelled,
  };
}

function toRoute(it: MItinerary): Route | null {
  const legs = (it.legs ?? []).map(toLeg).filter((l): l is TransitLeg => !!l);
  if (!legs.length) return null;
  const coords: [number, number][] = [];
  for (const l of legs) coords.push(...(coords.length ? l.coords.slice(1) : l.coords));
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const [x, y] of coords) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  const start = Date.parse(it.startTime ?? '') || legs[0].start;
  const end = Date.parse(it.endTime ?? '') || legs[legs.length - 1].end;
  return {
    coords,
    distance: legs.reduce((sum, l) => sum + l.distance, 0),
    duration: it.duration ?? (end - start) / 1000,
    maneuvers: [],
    bbox: [w, s, e, n],
    transit: {
      legs,
      start,
      end,
      transfers: it.transfers ?? Math.max(0, legs.filter((l) => l.ride).length - 1),
    },
  };
}

/** Connections by departure, then walking the whole way if the planner offers it. */
export function parseMotis(json: unknown): Route[] {
  const r = json as { itineraries?: MItinerary[]; direct?: MItinerary[] } | null;
  return [...(r?.itineraries ?? []), ...(r?.direct ?? [])]
    .map(toRoute)
    .filter((x): x is Route => !!x);
}
