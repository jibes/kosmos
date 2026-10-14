import type { LngLat } from './geo';
import type { Maneuver, Mode, Route } from './route';

/**
 * Turn-by-turn guidance on the device. The route comes from the router once; from then on every
 * GPS fix is matched to it here, so following a route never asks the server again. Pure: time and
 * positions come in as arguments, which is what makes it replayable in tests.
 */

const R = 6371008.8;
const RAD = Math.PI / 180;

/** Local metric projection around a latitude: good to well under 1 % over a few kilometres. */
function project([lng, lat]: [number, number], lat0: number): [number, number] {
  return [lng * RAD * R * Math.cos(lat0 * RAD), lat * RAD * R];
}

export interface Track {
  route: Route;
  /** Metres from the start to each shape point. */
  along: number[];
  /** Metres from the start to each maneuver. */
  at: number[];
  /** Seconds from each maneuver to the end, from the router's own estimates. */
  timeLeft: number[];
  lat0: number;
  xy: [number, number][];
}

export function track(route: Route): Track {
  const lat0 = route.coords[0][1];
  const xy = route.coords.map((c) => project(c, lat0));
  const along = [0];
  for (let i = 1; i < xy.length; i++) {
    along.push(along[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  }
  const at = route.maneuvers.map((m) => along[Math.min(m.begin, along.length - 1)]);
  const timeLeft: number[] = [];
  let t = 0;
  for (let i = route.maneuvers.length - 1; i >= 0; i--) {
    timeLeft[i] = t;
    t += route.maneuvers[i].duration;
  }
  return { route, along, at, timeLeft, lat0, xy };
}

export interface Snap {
  /** Metres along the route. */
  along: number;
  /** Metres from the fix to the route. */
  offset: number;
  /** Segment index the fix projects onto. */
  segment: number;
  /** The fix moved onto the route, [lng, lat]. */
  point: [number, number];
  /** Direction of travel there, degrees clockwise from north. */
  bearing: number;
}

/**
 * Projects a fix onto the route. Searches forward from the last match first, so a route that
 * passes the same street twice is followed in order; falls back to the whole route.
 */
export function snap(tr: Track, fix: LngLat, hint = 0): Snap {
  const p = project([fix.lng, fix.lat], tr.lat0);
  const best = { d: Infinity, seg: 0, f: 0 };
  const scan = (from: number, to: number) => {
    for (let i = Math.max(0, from); i < Math.min(tr.xy.length - 1, to); i++) {
      const [ax, ay] = tr.xy[i];
      const [bx, by] = tr.xy[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const f = len2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0;
      const d = Math.hypot(p[0] - (ax + f * dx), p[1] - (ay + f * dy));
      if (d < best.d) Object.assign(best, { d, seg: i, f });
    }
  };
  // Forward window of about a kilometre of shape points first.
  scan(hint, hint + 200);
  if (best.d > 50) scan(0, tr.xy.length);
  const [a, b] = [
    tr.route.coords[best.seg],
    tr.route.coords[best.seg + 1] ?? tr.route.coords[best.seg],
  ];
  const [ax, ay] = tr.xy[best.seg];
  const [bx, by] = tr.xy[best.seg + 1] ?? tr.xy[best.seg];
  return {
    along: tr.along[best.seg] + best.f * Math.hypot(bx - ax, by - ay),
    offset: best.d,
    segment: best.seg,
    point: [a[0] + best.f * (b[0] - a[0]), a[1] + best.f * (b[1] - a[1])],
    bearing: (Math.atan2(bx - ax, by - ay) / RAD + 360) % 360,
  };
}

export interface Fix extends LngLat {
  accuracy: number;
  /** m/s, when the device reports it. */
  speed?: number | null;
  /** ms since epoch. */
  time: number;
}

/** Device speeds below this are a phone at rest. */
const STILL_MS = 0.5;
/** Progress shorter than this is GPS noise: half the accuracy, at least 6 m. */
const jitterM = (accuracy: number) => Math.max(6, accuracy * 0.5);
/** After this long, small progress is a slow crawl or standing, not noise to wait out. */
const CRAWL_S = 8;
/** The route's direction takes over the heading above 3 m/s and gives it back below 1.5. */
const MOVING_ON_MS = 3;
const MOVING_OFF_MS = 1.5;

export interface NavState {
  snap: Snap | null;
  /** Index of the maneuver ahead. */
  next: number;
  toNext: number;
  remaining: number;
  /** Seconds to the destination. */
  eta: number;
  /** When the fix first left the route, ms; null while on it. */
  offSince: number | null;
  offRoute: boolean;
  arrived: boolean;
  /** Prompts already spoken, as `<maneuver>:<kind>`. */
  spoken: string[];
  /** m/s, smoothed. */
  speed: number;
  /**
   * Travelling fast enough for the route's direction to be the heading; below it the compass
   * says where the user faces. With hysteresis, so standing at a light does not flip it.
   */
  moving: boolean;
  /** Where speed was last measured from: progress only counts once it beats GPS jitter. */
  anchor: { along: number; time: number } | null;
  time: number;
}

export const initialNav = (): NavState => ({
  snap: null,
  next: 1,
  toNext: 0,
  remaining: 0,
  eta: 0,
  offSince: null,
  offRoute: false,
  arrived: false,
  spoken: [],
  speed: 0,
  moving: false,
  anchor: null,
  time: 0,
});

/** How far off the line counts as off-route: wide enough for GPS noise, narrow enough to notice. */
export const offRouteLimit = (accuracy: number) => Math.max(35, Math.min(accuracy * 1.5, 80));
/** How long a fix must stay off the line before rerouting. */
export const OFF_ROUTE_MS = 8_000;
export const ARRIVE_M = 25;

export function step(tr: Track, prev: NavState, fix: Fix): NavState {
  const s = snap(tr, fix, prev.snap?.segment ?? 0);
  // Never let a noisy fix move progress backwards by more than a few metres.
  const along =
    prev.snap && s.along < prev.snap.along - 30 && s.offset > 20 ? prev.snap.along : s.along;
  const total = tr.along[tr.along.length - 1];
  const off = s.offset > offRouteLimit(fix.accuracy);
  const offSince = off ? (prev.offSince ?? fix.time) : null;

  let next = Math.max(1, prev.next);
  while (next < tr.at.length - 1 && tr.at[next] <= along + 5) next++;
  const toNext = Math.max(0, tr.at[next] - along);

  // Time left: the router's estimate for the rest of the current maneuver, pro rata.
  const cur = next - 1;
  const legLen = Math.max(1, tr.at[next] - tr.at[cur]);
  const eta = tr.timeLeft[cur] + tr.route.maneuvers[cur].duration * Math.min(1, toNext / legLen);

  // Speed from the device, else from progress along the route. Standing still, a fix wanders
  // by metres; that only counts as movement once it beats the jitter (or enough time passed
  // to measure a crawl).
  let anchor = prev.anchor ?? { along, time: fix.time };
  let measured = prev.speed;
  if (fix.speed != null && fix.speed >= 0) {
    measured = fix.speed < STILL_MS ? 0 : fix.speed;
  } else {
    const moved = along - anchor.along;
    const dt = (fix.time - anchor.time) / 1000;
    if ((Math.abs(moved) >= jitterM(fix.accuracy) || dt >= CRAWL_S) && dt > 0.5) {
      measured = Math.abs(moved) < jitterM(fix.accuracy) ? 0 : Math.max(0, moved) / dt;
      anchor = { along, time: fix.time };
    }
  }
  const speed = prev.snap ? prev.speed * 0.5 + measured * 0.5 : measured;
  const moving = prev.moving ? speed > MOVING_OFF_MS : speed > MOVING_ON_MS;

  return {
    snap: { ...s, along },
    next,
    toNext,
    remaining: Math.max(0, total - along),
    eta: Math.max(0, eta),
    offSince,
    offRoute: offSince !== null && fix.time - offSince >= OFF_ROUTE_MS,
    arrived: total - along < ARRIVE_M && s.offset < 50,
    spoken: prev.spoken,
    speed,
    moving,
    anchor,
    time: fix.time,
  };
}

export interface Prompt {
  key: string;
  text: string;
}

/** Distances at which a maneuver is announced, by travel mode. */
const ALERT_M: Record<Mode, number> = { car: 600, bike: 200, foot: 80 };
const PRE_S = 8; // seconds before the maneuver at current speed
const PRE_MIN_M: Record<Mode, number> = { car: 60, bike: 25, foot: 12 };

/**
 * The prompt to speak now, if any: an early alert for the maneuver ahead, the precise
 * instruction just before it, and the "continue for …" line once it is done.
 */
export function prompt(tr: Track, st: NavState, mode: Mode): Prompt | null {
  if (!st.snap) return null;
  const said = (k: string) => st.spoken.includes(k);
  const ms = tr.route.maneuvers;
  if (st.arrived) {
    const last = ms.length - 1;
    const text = ms[last]?.pre ?? ms[last]?.instruction;
    return said(`${last}:pre`) || !text ? null : { key: `${last}:pre`, text };
  }
  const m: Maneuver | undefined = ms[st.next];
  if (!m) return null;
  const preAt = Math.max(PRE_MIN_M[mode], st.speed * PRE_S);
  if (st.toNext <= preAt && !said(`${st.next}:pre`)) {
    return { key: `${st.next}:pre`, text: m.pre ?? m.instruction };
  }
  if (
    st.toNext <= ALERT_M[mode] &&
    st.toNext > preAt * 1.8 &&
    !said(`${st.next}:alert`) &&
    m.alert
  ) {
    return { key: `${st.next}:alert`, text: m.alert };
  }
  const done = ms[st.next - 1];
  const sinceDone = st.snap.along - tr.at[st.next - 1];
  // "Continue for …" only when no alert for the next maneuver is due, so the two never collide.
  const alertDue = !!m.alert && st.toNext <= ALERT_M[mode];
  const quiet = !alertDue && st.toNext > preAt * 2;
  if (done?.post && quiet && sinceDone > 15 && sinceDone < 150 && !said(`${st.next - 1}:post`)) {
    return { key: `${st.next - 1}:post`, text: done.post };
  }
  return null;
}

/** Marks a prompt as spoken so it is never repeated. */
export const markSpoken = (st: NavState, key: string): NavState => ({
  ...st,
  spoken: [...st.spoken, key],
});

/** Camera zoom for the speed: close in a town, farther ahead on a motorway. */
export function navZoom(speed: number): number {
  const kmh = speed * 3.6;
  if (kmh < 15) return 17.5;
  if (kmh < 40) return 17;
  if (kmh < 70) return 16.2;
  if (kmh < 100) return 15.5;
  return 14.8;
}
