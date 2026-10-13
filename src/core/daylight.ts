/**
 * Day or night for the navigation theme: the sun's height from position and clock, and whether
 * the route runs through a tunnel. Pure; no sensor and no permission beyond the location the
 * guidance already has.
 */

const RAD = Math.PI / 180;
const R = 6371008.8;

/** The sun's upper edge touches the horizon, with refraction: sunrise and sunset. */
export const SUNSET_DEG = -0.833;
/** A tunnel keeps the map dark this long after the last fix inside it. */
export const TUNNEL_HOLD_MS = 4000;
/** Shorter tunnels (underpasses) pass too quickly to be worth a theme swap. */
export const TUNNEL_MIN_M = 100;
/** How close to a tunnel's centreline a fix counts as inside, and how aligned it must be. */
const TUNNEL_NEAR_M = 15;
const TUNNEL_ALIGN_DEG = 35;

/** Sun elevation in degrees above the horizon (low-precision almanac, well under 0.1°). */
export function sunElevation(lat: number, lng: number, time: number): number {
  const d = time / 86400000 + 2440587.5 - 2451545.0; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = 18.697374558 + 24.06570982441908 * d; // hours
  const ha = (gmst * 15 + lng) * RAD - ra;
  const phi = lat * RAD;
  return (
    Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha)) / RAD
  );
}

export const isNight = (lat: number, lng: number, time: number) =>
  sunElevation(lat, lng, time) < SUNSET_DEG;

type Pt = [number, number];

/**
 * Whether a position travelling along `bearing` is in one of the tunnel `lines` ([lng, lat]):
 * near a tunnel at least TUNNEL_MIN_M long and running along it, so a road crossing over or
 * under a tunnel does not count.
 */
export function inTunnel([lng0, lat0]: Pt, bearing: number, lines: Pt[][]): boolean {
  const k = Math.cos(lat0 * RAD);
  const xy = ([lng, lat]: Pt): Pt => [(lng - lng0) * RAD * R * k, (lat - lat0) * RAD * R];
  for (const line of lines) {
    const p = line.map(xy);
    let length = 0;
    let near = false;
    for (let i = 1; i < p.length; i++) {
      const [ax, ay] = p[i - 1];
      const dx = p[i][0] - ax;
      const dy = p[i][1] - ay;
      const len = Math.hypot(dx, dy);
      length += len;
      if (near || !len) continue;
      const f = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (len * len)));
      if (Math.hypot(ax + f * dx, ay + f * dy) > TUNNEL_NEAR_M) continue;
      // Lines have no travel direction: compare modulo 180°.
      const seg = Math.atan2(dx, dy) / RAD;
      const diff = (((seg - bearing) % 180) + 180) % 180;
      near = Math.min(diff, 180 - diff) <= TUNNEL_ALIGN_DEG;
    }
    if (near && length >= TUNNEL_MIN_M) return true;
  }
  return false;
}
