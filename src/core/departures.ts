import type { LngLat } from './geo';
import { TRANSIT_URL, textOn } from './transit';

/**
 * The next departures from a stop, for its place card: one Transitous request when the card
 * opens (`/api/v5/stoptimes` around the stop's point), never repeated on its own.
 */

/** A departure as the card shows it: when (live where known), which line, where to. */
export interface Departure {
  /** Epoch milliseconds, with real-time data where there is any. */
  time: number;
  /** Minutes behind (positive) or ahead of the timetable. */
  delay: number;
  /** MOTIS mode: BUS, TRAM, SUBWAY, REGIONAL_RAIL, … */
  mode: string;
  line?: string;
  headsign?: string;
  color?: string;
  textColor?: string;
  track?: string;
  /** The platform is not the timetable's. */
  moved: boolean;
  cancelled: boolean;
}

/** Around the stop's point: its platforms and the stops of the same station. */
const RADIUS_M = 150;
export const DEPARTURES_SHOWN = 6;

export const stopTimesUrl = (at: LngLat, lang: string) =>
  `${TRANSIT_URL}/api/v5/stoptimes?${new URLSearchParams({
    center: `${at.lat.toFixed(6)},${at.lng.toFixed(6)}`,
    radius: String(RADIUS_M),
    n: String(DEPARTURES_SHOWN * 2),
    language: lang,
  })}`;

interface MStopTime {
  place?: {
    departure?: string;
    scheduledDeparture?: string;
    track?: string;
    scheduledTrack?: string;
  };
  mode?: string;
  headsign?: string;
  displayName?: string;
  routeShortName?: string;
  routeColor?: string;
  routeTextColor?: string;
  cancelled?: boolean;
  tripCancelled?: boolean;
}

const hex = (c: unknown) =>
  typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c)
    ? `#${c.replace('#', '').toLowerCase()}`
    : undefined;

/** A departure that left this long ago is still worth running for, not more. */
export const GONE_MS = 60_000;

/**
 * The departures in a stoptimes answer, soonest first: the same vehicle once (a station's
 * stops overlap), none already gone; all of them, so a card left open has more to come.
 */
export function parseDepartures(json: unknown, now: number): Departure[] {
  const times = (json as { stopTimes?: MStopTime[] } | null)?.stopTimes;
  if (!Array.isArray(times)) return [];
  const seen = new Set<string>();
  const out: Departure[] = [];
  for (const st of times) {
    const time = Date.parse(st.place?.departure ?? '');
    if (!Number.isFinite(time) || time < now - GONE_MS) continue;
    const planned = Date.parse(st.place?.scheduledDeparture ?? '');
    const line = st.displayName || st.routeShortName || undefined;
    const key = `${line}|${st.headsign}|${Number.isFinite(planned) ? planned : time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const color = hex(st.routeColor);
    const track = st.place?.track;
    out.push({
      time,
      delay: Number.isFinite(planned) ? Math.round((time - planned) / 60_000) : 0,
      mode: st.mode ?? 'OTHER',
      ...(line ? { line } : {}),
      ...(st.headsign ? { headsign: st.headsign } : {}),
      ...(color ? { color, textColor: hex(st.routeTextColor) ?? textOn(color) } : {}),
      ...(track ? { track } : {}),
      moved: !!track && !!st.place?.scheduledTrack && track !== st.place.scheduledTrack,
      cancelled: !!(st.cancelled || st.tripCancelled),
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** OpenMapTiles `poi` values of stops and stations, as a tapped label's feature has them. */
const STOP_CLASSES = new Set(['railway', 'bus', 'ferry_terminal', 'aerialway']);
const STOP_SUBCLASSES = new Set([
  'station',
  'halt',
  'tram_stop',
  'subway_entrance',
  'bus_stop',
  'bus_station',
  'ferry_terminal',
]);

export const isStopPoi = (p: Record<string, unknown>) =>
  STOP_CLASSES.has(String(p.class)) || STOP_SUBCLASSES.has(String(p.subclass));

/** Photon's OSM key and value of a stop or station. */
export const isStopOsm = (key: string | undefined, value: string | undefined) =>
  (key === 'railway' && ['station', 'halt', 'tram_stop'].includes(value ?? '')) ||
  (key === 'public_transport' && ['station', 'stop_position', 'platform'].includes(value ?? '')) ||
  (key === 'highway' && value === 'bus_stop') ||
  (key === 'amenity' && ['bus_station', 'ferry_terminal'].includes(value ?? ''));

/**
 * The departures still to come at `now`, at most `DEPARTURES_SHOWN`: a card left open does not
 * list those gone, and the later ones asked for take their place.
 */
export const stillToCome = (list: Departure[], now: number) =>
  list.filter((d) => d.time >= now - GONE_MS).slice(0, DEPARTURES_SHOWN);
