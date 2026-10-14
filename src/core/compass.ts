/**
 * Compass heading from device-orientation events. Pure: the browser event's fields and the screen
 * rotation come in, degrees clockwise from true-ish north come out.
 */

export interface OrientationReading {
  /** Rotation around the z axis, 0–360, counter-clockwise; absolute when `absolute` is true. */
  alpha: number | null;
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

/**
 * Heading the top of the device points at, corrected for screen rotation. `null` when the
 * reading is not anchored to north (a relative alpha says nothing about direction).
 */
export function headingOf(r: OrientationReading, screenAngle = 0): number | null {
  if (r.webkitCompassHeading != null && Number.isFinite(r.webkitCompassHeading)) {
    return norm(r.webkitCompassHeading + screenAngle);
  }
  if (!r.absolute || r.alpha == null || !Number.isFinite(r.alpha)) return null;
  return norm(360 - r.alpha + screenAngle);
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
