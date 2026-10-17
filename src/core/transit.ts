import { distance, type LngLat } from './geo';
import { decodePolyline, type Route, type Turn } from './route';

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
  /** The platform the timetable planned, when live data moved it. */
  scheduledTrack?: string;
  /** The timetable's stop id, for asking about departures there. */
  id?: string;
  /** The vehicle no longer calls here (live data). */
  skipped?: boolean;
}

/** A turn on a walk: where it is along the walk and onto which street. */
export interface WalkStep {
  turn: Turn;
  street?: string;
  /** Metres from the start of the walk. */
  at: number;
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
  /** Walks: the turns along the way (empty when the planner sent none). */
  steps: WalkStep[];
  /** Rides: the timetable's trip id, which identifies this vehicle at the boarding stop. */
  trip?: string;
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
  scheduledTrack?: string;
  stopId?: string;
  arrival?: string;
  departure?: string;
  scheduledDeparture?: string;
  cancelled?: boolean;
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
  tripId?: string;
  steps?: { relativeDirection?: string; distance?: number; streetName?: string }[];
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
  ...(p?.scheduledTrack ? { scheduledTrack: p.scheduledTrack } : {}),
  ...(p?.stopId ? { id: p.stopId } : {}),
  ...(p?.cancelled ? { skipped: true } : {}),
});

/** MOTIS step directions as the arrows kOSMos draws; stairs and lifts read as straight on. */
const TURNS: Record<string, Turn> = {
  DEPART: 'depart',
  HARD_LEFT: 'sharp-left',
  LEFT: 'left',
  SLIGHTLY_LEFT: 'slight-left',
  SLIGHTLY_RIGHT: 'slight-right',
  RIGHT: 'right',
  HARD_RIGHT: 'sharp-right',
  CIRCLE_CLOCKWISE: 'roundabout',
  CIRCLE_COUNTERCLOCKWISE: 'roundabout',
  UTURN_LEFT: 'uturn',
  UTURN_RIGHT: 'uturn',
};

function walkSteps(raw: MLeg['steps']): WalkStep[] {
  const out: WalkStep[] = [];
  let at = 0;
  for (const st of raw ?? []) {
    const turn = TURNS[st.relativeDirection ?? ''] ?? 'straight';
    out.push({ turn, ...(st.streetName ? { street: st.streetName } : {}), at });
    at += st.distance ?? 0;
  }
  return out;
}

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
    steps: ride ? [] : walkSteps(l.steps),
    ...(ride && l.tripId ? { trip: l.tripId } : {}),
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

/** Check the boarding departure (delay, platform, cancellation) once, in the last ten minutes. */
export const DEPARTURE_CHECK_MS = 10 * 60_000;

/**
 * The ride's own vehicle (`/api/v5/trip`): every stop of its trip with live times, platforms and
 * cancellations. One request answers for one ride, at any station, however busy.
 */
export function tripUrl(leg: TransitLeg, lang: string): string | null {
  if (!leg.ride || !leg.trip) return null;
  return `${TRANSIT_URL}/api/v5/trip?${new URLSearchParams({ tripId: leg.trip, language: lang })}`;
}

type MStop = MPlace & { arrival?: string };

/**
 * The connection with ride `i` on its vehicle's live times: departure and platform where it is
 * boarded, arrival where it is left and at each stop between, stops it no longer calls at, and
 * cancellation. The walk after the ride moves with the arrival; the next ride keeps its own
 * time. `null` when the answer does not hold the boarding stop.
 */
export function withLiveTrip(transit: Transit, i: number, json: unknown): Transit | null {
  const leg = transit.legs[i];
  const legs = (json as MItinerary | null)?.legs;
  const ride =
    legs?.find((l) => l.tripId === leg?.trip) ?? legs?.find((l) => !OWN_WAY.has(l.mode ?? ''));
  if (!leg || !ride) return null;
  const places = [ride.from, ...(ride.intermediateStops ?? []), ride.to].filter(
    (p): p is MStop => !!p,
  );
  // By the timetable's stop id where both have one, else by name (one trip calls once at each).
  const find = (s: Stop) =>
    places.find((p) => (s.id && p.stopId ? p.stopId === s.id : p.name === s.name));
  const board = find(leg.from);
  const departure = Date.parse(board?.departure ?? '');
  if (!board || !Number.isFinite(departure)) return null;
  const alight = find(leg.to);
  const arrival = Date.parse(alight?.arrival ?? '');
  const shift = departure - leg.start;
  const end = Number.isFinite(arrival) ? arrival : leg.end + shift;
  const scheduled = Date.parse(board.scheduledDeparture ?? '');
  const moved: TransitLeg = {
    ...leg,
    start: departure,
    end,
    via: leg.via.map((v) => {
      const p = find(v);
      const a = Date.parse(p?.arrival ?? '');
      return {
        ...v,
        ...(Number.isFinite(a)
          ? { arrival: a }
          : v.arrival !== undefined
            ? { arrival: v.arrival + shift }
            : {}),
        ...(p?.cancelled ? { skipped: true } : {}),
      };
    }),
    delay: Number.isFinite(scheduled) ? Math.round((departure - scheduled) / 60_000) : leg.delay,
    from: {
      ...leg.from,
      ...(board.track ? { track: board.track } : {}),
      ...(board.scheduledTrack ? { scheduledTrack: board.scheduledTrack } : {}),
    },
    cancelled: !!(ride.cancelled || board.cancelled || alight?.cancelled),
  };
  const later = end - leg.end;
  let walking = true;
  const out = transit.legs.map((l, k) => {
    if (k === i) return moved;
    if (k < i || !walking || l.ride) {
      if (k > i) walking = false;
      return l;
    }
    return { ...l, start: l.start + later, end: l.end + later };
  });
  return { ...transit, legs: out, end: out[out.length - 1].end };
}

export type Vehicle = 'bus' | 'tram' | 'subway' | 'train' | 'ferry' | 'cable' | 'plane';

/** The kind of vehicle a MOTIS mode is, for its symbol; `null` for walking and the unknown. */
export function vehicleOf(mode: string): Vehicle | null {
  switch (mode) {
    case 'BUS':
    case 'COACH':
    case 'ODM':
    case 'FLEX':
      return 'bus';
    case 'TRAM':
      return 'tram';
    case 'SUBWAY':
    case 'METRO':
      return 'subway';
    case 'RAIL':
    case 'HIGHSPEED_RAIL':
    case 'LONG_DISTANCE':
    case 'NIGHT_RAIL':
    case 'REGIONAL_FAST_RAIL':
    case 'REGIONAL_RAIL':
    case 'SUBURBAN':
      return 'train';
    case 'FERRY':
      return 'ferry';
    case 'FUNICULAR':
    case 'AERIAL_LIFT':
    case 'AREAL_LIFT':
    case 'CABLE_CAR':
      return 'cable';
    case 'AIRPLANE':
      return 'plane';
    default:
      return null;
  }
}

/** How many of a ride's stops before `via[k]` it stops at: skipped ones are passed by. */
export const servedBefore = (l: Pick<TransitLeg, 'via'>, k: number) =>
  l.via.slice(0, k).filter((v) => !v.skipped).length;

/**
 * The connection's first vehicle has left already: a plan for "now" left open too long. Its
 * own leg's start counts (with a live delay where it was checked), not the walk before it.
 */
export function departed(tr: Transit, now: number): boolean {
  const first = tr.legs.find((l) => l.ride);
  return !!first && first.start < now;
}
