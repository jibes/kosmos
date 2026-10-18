import { angleDiff } from './compass';
import { distance, type LngLat } from './geo';
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
  /** How the route is travelled: on foot, off the route is noticed sooner. */
  mode: Mode;
  /** Metres from the start to each shape point. */
  along: number[];
  /** Metres from the start to each maneuver. */
  at: number[];
  /** Seconds from each maneuver to the end, from the router's own estimates. */
  timeLeft: number[];
  lat0: number;
  xy: [number, number][];
}

export function track(route: Route, mode: Mode = 'car'): Track {
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
  return { route, mode, along, at, timeLeft, lat0, xy };
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
 * passes the same street twice is followed in order; falls back to the whole route. With
 * `reach`, a match further along than that many metres is not believed while a nearer one
 * fits: where the route crosses itself, or runs back on the other carriageway, a fix a few
 * metres to the side must not skip the turns in between.
 */
export function snap(
  tr: Track,
  fix: LngLat,
  hint = 0,
  reach?: { from: number; ahead: number },
): Snap {
  const p = project([fix.lng, fix.lat], tr.lat0);
  const best = { d: Infinity, seg: 0, f: 0 };
  const scan = (from: number, to: number, limit = Infinity) => {
    for (let i = Math.max(0, from); i < Math.min(tr.xy.length - 1, to); i++) {
      if (tr.along[i] > limit) break;
      const [ax, ay] = tr.xy[i];
      const [bx, by] = tr.xy[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let f = len2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0;
      // Within reach only: the part of a long segment beyond it does not count.
      const seg = tr.along[i + 1] - tr.along[i];
      if (seg > 0 && tr.along[i] + f * seg > limit) f = (limit - tr.along[i]) / seg;
      const d = Math.hypot(p[0] - (ax + f * dx), p[1] - (ay + f * dy));
      if (d < best.d) Object.assign(best, { d, seg: i, f });
    }
  };
  // Forward window of about a kilometre of shape points first, as far as one could have got.
  scan(hint, hint + 200, reach ? reach.from + reach.ahead : Infinity);
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
  /** Course over ground, degrees clockwise from north, when moving and reported. */
  heading?: number | null;
  /** ms since epoch. */
  time: number;
}

/**
 * A fix less precise than this moves the dot, not the guidance: no turn is passed or skipped,
 * and no reroute is asked, on a guess (network fixes, a tunnel, approximate location only).
 */
export const COARSE_M = 65;
/** A maneuver is done once this far past it, on the road after it: going straight on at a
 * turn, or waiting at the light just before it, does not count as taking it. */
const PAST_M = 10;
/** Driving this far back along the route is going the wrong way. */
const BACK_M = 40;
/** A course this far from the route's direction, for this many fixes in a row, too. */
const AGAINST_DEG = 135;
const AGAINST_N = 3;
/** Before reaching the route (from a car park or a building), only moving this much further
 * away from its start is off it. */
const LEAVE_M = 150;

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
  /** The last fix was too coarse to guide by. */
  weak: boolean;
  /** On the route at least once; before that, the user is still getting to it. */
  joined: boolean;
  /** Closest to the route's start so far, metres, while getting to it. */
  approach: number | null;
  /** How far the route's start is now, metres, while getting to it; `null` once on it. */
  toRoute: number | null;
  /** Furthest along the route so far, metres. */
  peak: number;
  /** Fixes in a row moving against the route's direction. */
  against: number;
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
  weak: false,
  joined: false,
  approach: null,
  toRoute: null,
  peak: 0,
  against: 0,
  time: 0,
});

/**
 * How far off the line counts as off-route: wide enough for GPS noise, narrow enough to notice.
 * On foot a wrong path often runs within 35 m of the right one (the other side of a square, a
 * parallel lane), so with a good fix 20 m is enough there.
 */
export const offRouteLimit = (accuracy: number, mode: Mode = 'car') =>
  Math.max(mode === 'foot' ? 20 : 35, Math.min(accuracy * 1.5, 80));
/** How long a fix must stay off the line before rerouting. */
export const OFF_ROUTE_MS = 8_000;
export const ARRIVE_M = 25;

/**
 * How far along the route a fix may be from the last one: what the fastest plausible travel
 * since then covers, plus the GPS error. The first fix may be up to a stale start away (the
 * route is reused within 150 m of where it was asked for).
 */
function reachOf(prev: NavState, fix: Fix): { from: number; ahead: number } {
  const slack = 40 + Math.min(fix.accuracy, COARSE_M) * 2;
  if (!prev.snap) return { from: 0, ahead: 150 + slack };
  const dt = Math.min(120, Math.max(1, (fix.time - prev.time) / 1000));
  const fast = Math.max(prev.speed, fix.speed ?? 0, 15) * 1.5;
  return { from: prev.snap.along, ahead: slack + fast * dt };
}

export function step(tr: Track, prev: NavState, fix: Fix): NavState {
  // Once arrived, guidance has done its job; a GPS wobble at the door does not undo it.
  if (prev.arrived && prev.snap)
    return { ...prev, time: fix.time, offSince: null, offRoute: false };
  // Too coarse to tell which road, let alone which side of a turn: wait for a better fix.
  if (fix.accuracy > COARSE_M) return { ...prev, weak: true };
  const s = snap(tr, fix, prev.snap?.segment ?? 0, reachOf(prev, fix));
  // Never let a noisy fix move progress backwards by more than a few metres.
  const along =
    prev.snap && s.along < prev.snap.along - 30 && s.offset > 20 ? prev.snap.along : s.along;
  const total = tr.along[tr.along.length - 1];
  const onLine = s.offset <= offRouteLimit(fix.accuracy, tr.mode);
  const joined = prev.joined || onLine;
  // Still getting to the route (it starts on the road nearest to where it was asked from):
  // heading for its start is not off it; only moving well away from it is.
  let approach = prev.approach;
  let toRoute: number | null = null;
  let off = !onLine;
  if (!joined) {
    toRoute = distance(fix, { lng: tr.route.coords[0][0], lat: tr.route.coords[0][1] });
    approach = Math.min(approach ?? toRoute, toRoute);
    off = toRoute > approach + LEAVE_M;
  }
  // The wrong way along the route: going back down it, or a course against it.
  const peak = Math.max(prev.peak, along);
  const course = fix.heading != null && Number.isFinite(fix.heading) ? fix.heading : null;
  const against =
    onLine && course !== null && prev.moving && Math.abs(angleDiff(course, s.bearing)) > AGAINST_DEG
      ? prev.against + 1
      : 0;
  if (joined && onLine && (against >= AGAINST_N || peak - along > BACK_M)) off = true;
  const offSince = off ? (prev.offSince ?? fix.time) : null;

  let next = Math.max(1, prev.next);
  // Back before the maneuver just done (driving back, a jump undone): it is ahead again.
  while (next > 1 && along < tr.at[next - 1] - 2 * PAST_M) next--;
  // Done only once past it on the road after it.
  while (next < tr.at.length - 1 && onLine && along > tr.at[next] + PAST_M) next++;
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
    weak: false,
    joined,
    approach,
    toRoute,
    peak,
    against,
    time: fix.time,
  };
}

/** The public router is asked again at most this often, however lost the driver is. */
export const REROUTE_MS = 30_000;

/** Where and when the router was last asked for a new route, and how often in a row there. */
export interface RerouteMark {
  lng: number;
  lat: number;
  time: number;
  count: number;
}

const movedOn = (last: RerouteMark, fix: Fix) =>
  distance(last, fix) > Math.max(50, 2 * fix.accuracy);

/**
 * Whether to ask the router again now. Every 30 s at most; standing in the same wrong place
 * (a car park beside the road), it backs off to 1, 2 and 4 minutes instead of asking for the
 * same route over and over.
 */
export function rerouteDue(last: RerouteMark | null, fix: Fix): boolean {
  if (!last) return true;
  const wait = movedOn(last, fix) ? REROUTE_MS : REROUTE_MS * 2 ** Math.min(last.count + 1, 3);
  return fix.time - last.time >= wait;
}

export const markReroute = (last: RerouteMark | null, fix: Fix): RerouteMark => ({
  lng: fix.lng,
  lat: fix.lat,
  time: fix.time,
  count: last && !movedOn(last, fix) ? last.count + 1 : 0,
});

export interface Prompt {
  key: string;
  text: string;
  /** Metres to the maneuver, to say before the text ("In 500 m, turn right …"). The router's
   * alert carries no distance of its own. */
  distance?: number;
  /** Not the router's words: the route starts further off, the user is to head there first. */
  head?: true;
}

/** Further than this from the route's start at first, the user heads there before its first
 * words ("Head north on …"), which only make sense on it. */
export const HEAD_M = 30;

/** Still getting to a route that starts further off. */
export const headingToRoute = (st: NavState) =>
  !st.joined && st.toRoute !== null && st.toRoute > HEAD_M;

/** A final instruction this far ahead (fast roads) still says how far. */
const PRE_WITH_DISTANCE_M = 150;

/** Distances at which a maneuver is announced, by travel mode; further out when fast. */
const ALERT_M: Record<Mode, number> = { car: 600, bike: 200, foot: 80 };
/** On a motorway the early alert comes this long ahead, so it never falls inside the last one. */
const ALERT_S = 30;
const alertAt = (mode: Mode, speed: number) => Math.max(ALERT_M[mode], speed * ALERT_S);
const PRE_S = 8; // seconds before the maneuver at current speed
const PRE_MIN_M: Record<Mode, number> = { car: 60, bike: 25, foot: 12 };

/**
 * The prompt to speak now, if any: an early alert for the maneuver ahead, the precise
 * instruction just before it, and the "continue for …" line once it is done.
 */
export function prompt(tr: Track, st: NavState, mode: Mode): Prompt | null {
  if (!st.snap) return null;
  // Off the route nothing ahead on it applies; a new route brings its own words.
  if (!st.arrived && st.offSince !== null) return null;
  const said = (k: string) => st.spoken.includes(k);
  const ms = tr.route.maneuvers;
  // How it sets off: first to the route where it starts further off, its own words once there.
  if (!st.arrived && headingToRoute(st)) {
    return said('0:head') ? null : { key: '0:head', text: '', head: true };
  }
  const depart = ms[0];
  if (!st.arrived && depart && !said('0:pre')) {
    return { key: '0:pre', text: depart.pre ?? depart.instruction };
  }
  if (st.arrived) {
    const last = ms.length - 1;
    const text = ms[last]?.pre ?? ms[last]?.instruction;
    return said(`${last}:pre`) || !text ? null : { key: `${last}:pre`, text };
  }
  const m: Maneuver | undefined = ms[st.next];
  if (!m) return null;
  // The destination's own words ("You have arrived") are for arriving, not for approaching.
  const last = st.next === ms.length - 1;
  const preAt = Math.max(PRE_MIN_M[mode], st.speed * PRE_S);
  const alertM = alertAt(mode, st.speed);
  if (!last && st.toNext <= preAt && !said(`${st.next}:pre`)) {
    return {
      key: `${st.next}:pre`,
      text: m.pre ?? m.instruction,
      ...(st.toNext >= PRE_WITH_DISTANCE_M ? { distance: st.toNext } : {}),
    };
  }
  if (
    st.toNext <= alertM &&
    (st.toNext > preAt * 1.8 || last) &&
    !said(`${st.next}:alert`) &&
    m.alert
  ) {
    return { key: `${st.next}:alert`, text: m.alert, distance: st.toNext };
  }
  const done = ms[st.next - 1];
  const sinceDone = st.snap.along - tr.at[st.next - 1];
  // "Continue for …" only when no alert for the next maneuver is due, so the two never collide.
  const alertDue = !!m.alert && st.toNext <= alertM;
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

/**
 * A prompt is said only about a fix this fresh. Should the page have been held up (a phone
 * suspends a page it does not show), the fixes queued meanwhile come all at once, and words
 * about turns long passed would follow one another; guidance still steps through them.
 */
export const SAY_MAX_AGE_MS = 15_000;
export const sayable = (fixTime: number, now: number) => now - fixTime < SAY_MAX_AGE_MS;
