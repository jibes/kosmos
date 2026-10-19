import { pointAt, type Track } from './nav';

/**
 * The arrow between fixes, frame by frame: fixes come about once a second, often late, doubled
 * or in bursts, so moving to each one (or easing there) stops and starts. Instead the arrow
 * runs on at the speed last measured (along the road on the route, along its course off it),
 * at most `AHEAD_S` past the last fix, and drifts toward where that fix says it should be by
 * now, so a fix corrects its pace instead of starting a move.
 */

/** Time constant of the pull toward the fix, seconds. */
export const GLIDE_TAU_S = 0.6;
/** Of turning to a new heading, seconds. */
export const HEADING_TAU_S = 0.35;
/** Running on without a fix at most this long, seconds: GPS lost, the arrow stops. */
export const AHEAD_S = 2;
/** Further than this from the fix, the arrow goes there at once (a reroute, a jump). */
export const JUMP_M = 150;
/** Running on no faster than this, m/s (250 km/h): a jumpy fix's speed is not believed. */
export const RUN_MAX_MS = 70;

/** Where the last fix puts the arrow, and how fast it goes. */
export interface Aim {
  /** Along the route, metres, when on it. */
  along: number | null;
  point: [number, number];
  /** m/s; 0 standing still. */
  speed: number;
  /** Which way it goes, degrees; unknown: as it was. */
  bearing: number | null;
  /** When it came, ms (the clock frames are drawn by). */
  at: number;
}

/** Where the arrow is drawn. */
export interface Shown {
  along: number | null;
  point: [number, number];
  heading: number;
  at: number;
}

const RAD = Math.PI / 180;
const M_PER_DEG = 111_320;

/** The share of what is left to close in `dt` seconds, for a time constant `tau`. */
export const ease = (dt: number, tau: number) => (tau > 0 ? 1 - Math.exp(-dt / tau) : 1);

/** From `a` toward `b` the short way round, by `k`. */
export const turnToward = (a: number, b: number, k: number) =>
  (a + (((((b - a) % 360) + 540) % 360) - 180) * k + 360) % 360;

/** `p` moved `m` metres toward `bearing`. */
function ahead([lng, lat]: [number, number], m: number, bearing: number): [number, number] {
  const dy = m * Math.cos(bearing * RAD);
  const dx = m * Math.sin(bearing * RAD);
  return [lng + dx / (M_PER_DEG * Math.cos(lat * RAD)), lat + dy / M_PER_DEG];
}

const metres = (a: [number, number], b: [number, number]) =>
  Math.hypot((b[0] - a[0]) * M_PER_DEG * Math.cos(a[1] * RAD), (b[1] - a[1]) * M_PER_DEG);

/** The arrow at `now`, a frame after `shown` (none yet: at the fix). */
export function glideStep(shown: Shown | null, aim: Aim, now: number, tr: Track | null): Shown {
  if (!shown) return { along: aim.along, point: aim.point, heading: aim.bearing ?? 0, at: now };
  // A frame long delayed (the app put away) moves no further than a quick one.
  const dt = Math.max(0, Math.min(0.25, (now - shown.at) / 1000));
  const since = Math.max(0, (now - aim.at) / 1000);
  // How far on from the fix by now, and how fast still: stopped once it has run too long.
  const speed = Math.min(aim.speed, RUN_MAX_MS);
  const run = speed * Math.min(since, AHEAD_S);
  const v = since < AHEAD_S ? speed : 0;
  const k = ease(dt, GLIDE_TAU_S);
  const heading = turnToward(shown.heading, aim.bearing ?? shown.heading, ease(dt, HEADING_TAU_S));

  if (tr && aim.along !== null && shown.along !== null) {
    const target = aim.along + run;
    if (Math.abs(aim.along - shown.along) > JUMP_M) {
      return { along: target, point: pointAt(tr, target).point, heading, at: now };
    }
    let along = shown.along + v * dt + (target - shown.along - v * dt) * k;
    // Never back down the road while going on: a fix behind only slows it down.
    if (aim.speed > 0) along = Math.max(along, shown.along);
    return { along, point: pointAt(tr, along).point, heading, at: now };
  }

  // Off the route, or getting back to it: toward where the fix runs on to by now.
  const onRoad = tr && aim.along !== null;
  const targetAlong = onRoad ? aim.along! + run : null;
  const course = aim.bearing ?? shown.heading;
  const target = onRoad ? pointAt(tr, targetAlong!).point : ahead(aim.point, run, course);
  if (metres(shown.point, aim.point) > JUMP_M) {
    return { along: targetAlong, point: target, heading, at: now };
  }
  const moved = ahead(shown.point, v * dt, course);
  const point: [number, number] = [
    moved[0] + (target[0] - moved[0]) * k,
    moved[1] + (target[1] - moved[1]) * k,
  ];
  // Back on the road once there.
  const along = targetAlong !== null && metres(point, target) < 3 ? targetAlong : null;
  return { along, point, heading, at: now };
}

/** Nothing left to draw: standing, or run on as far as it goes, there and facing its way. */
export function settled(shown: Shown, aim: Aim, now: number): boolean {
  const since = Math.max(0, (now - aim.at) / 1000);
  if (aim.speed > 0 && since < AHEAD_S) return false;
  const run = Math.min(aim.speed, RUN_MAX_MS) * Math.min(since, AHEAD_S);
  const bearing = aim.bearing ?? shown.heading;
  const off =
    shown.along !== null && aim.along !== null
      ? Math.abs(shown.along - (aim.along + run))
      : metres(shown.point, ahead(aim.point, run, bearing));
  const turn = Math.abs(((((bearing - shown.heading) % 360) + 540) % 360) - 180);
  return off < 0.05 && turn < 0.1;
}
