/**
 * Compass heading from device-orientation events. Pure: the browser event's fields and the screen
 * rotation come in, degrees clockwise from true-ish north come out.
 */

export interface OrientationReading {
  /** Rotation around the z axis, 0–360, counter-clockwise; absolute when `absolute` is true. */
  alpha: number | null;
  /** Front-to-back tilt, -180–180: 0 lying flat, 90 standing upright facing the user. */
  beta?: number | null;
  /** Left-to-right tilt, -90–90. */
  gamma?: number | null;
  absolute: boolean;
  /** Safari's ready-made compass heading, clockwise from north. */
  webkitCompassHeading?: number | null;
}

export const norm = (deg: number) => ((deg % 360) + 360) % 360;

/** Signed shortest turn from `a` to `b`, in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = norm(b - a);
  return d > 180 ? d - 360 : d;
}

const RAD = Math.PI / 180;
const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/**
 * Heading the phone points at, corrected for screen rotation: the top of the screen while the
 * phone lies flat, out of its back once it stands upright like a torch, a blend between. The
 * top edge alone (`360 - alpha`) fails upright: it points at the sky, and the slightest roll
 * leans it sideways, swinging the heading up to 90° off. `null` when the reading is not anchored
 * to north (a relative alpha says nothing about direction).
 */
export function headingOf(r: OrientationReading, screenAngle = 0): number | null {
  if (finite(r.webkitCompassHeading)) return norm(r.webkitCompassHeading + screenAngle);
  if (!r.absolute || !finite(r.alpha)) return null;
  if (!finite(r.beta) || !finite(r.gamma)) return norm(360 - r.alpha + screenAngle);
  // The device's axes in east, north, up (W3C: R = Rz(alpha) Rx(beta) Ry(gamma)): x to the
  // right of the screen, y to its top, z out of its face.
  const [sa, ca] = [Math.sin(r.alpha * RAD), Math.cos(r.alpha * RAD)];
  const [sb, cb] = [Math.sin(r.beta * RAD), Math.cos(r.beta * RAD)];
  const [sg, cg] = [Math.sin(r.gamma * RAD), Math.cos(r.gamma * RAD)];
  const x = [ca * cg - sa * sb * sg, sa * cg + ca * sb * sg];
  const y = [-sa * cb, ca * cb];
  const z = [ca * sg + sa * sb * cg, sa * sg - ca * sb * cg];
  // The top of the screen as the user sees it (a turned screen puts it on a side of the
  // device) and the back, each on the ground and weighted by its own length there: the one
  // lying more level leads, and a near-vertical one cannot swing the result.
  const [ss, cs] = [Math.sin(screenAngle * RAD), Math.cos(screenAngle * RAD)];
  const top = [ss * x[0] + cs * y[0], ss * x[1] + cs * y[1]];
  const back = [-z[0], -z[1]];
  const wt = Math.hypot(top[0], top[1]);
  const wb = Math.hypot(back[0], back[1]);
  const east = top[0] * wt + back[0] * wb;
  const north = top[1] * wt + back[1] * wb;
  // Only a phone held at odd angles (screen up, top pointing down) cancels out; skip it.
  if (Math.hypot(east, north) < 1e-3) return null;
  return norm(Math.atan2(east, north) / RAD);
}

/**
 * Low-pass filter on the circle: follows real turns, irons out magnetometer jitter, and never
 * spins the long way round across north.
 */
export function smoothHeading(prev: number | null, next: number, k = 0.25): number {
  if (prev == null) return norm(next);
  return norm(prev + angleDiff(prev, next) * k);
}

/**
 * Direction to show: the route's course while moving (see `NavState.moving`), else the
 * compass, since standing or walking slowly GPS course is noise.
 */
export function travelHeading(
  course: number | null,
  compass: number | null,
  moving: boolean,
): number | null {
  if (moving && course != null) return course;
  return compass ?? course;
}
