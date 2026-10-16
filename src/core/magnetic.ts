/**
 * Magnetic declination from the World Magnetic Model 2025 (NOAA / BGS, public domain): how far
 * a compass's north lies east of true north. Phones read magnetic north; the map is drawn to
 * true north, so headings add this. Valid 2025–2030, degree and order 12.
 */
import type { LngLat } from './geo';

const EPOCH = 2025;
/** Rows n = 1…12, entries m = 0…n, in nT and nT a year. */
const G = [
  [-29351.8, -1410.8],
  [-2556.6, 2951.1, 1649.3],
  [1361, -2404.1, 1243.8, 453.6],
  [895, 799.5, 55.7, -281.1, 12.1],
  [-233.2, 368.9, 187.2, -138.7, -142, 20.9],
  [64.4, 63.8, 76.9, -115.7, -40.9, 14.9, -60.7],
  [79.5, -77, -8.8, 59.3, 15.8, 2.5, -11.1, 14.2],
  [23.2, 10.8, -17.5, 2, -21.7, 16.9, 15, -16.8, 0.9],
  [4.6, 7.8, 3, -0.2, -2.5, -13.1, 2.4, 8.6, -8.7, -12.9],
  [-1.3, -6.4, 0.2, 2, -1, -0.6, -0.9, 1.5, 0.9, -2.7, -3.9],
  [2.9, -1.5, -2.5, 2.4, -0.6, -0.1, -0.6, -0.1, 1.1, -1, -0.2, 2.6],
  [-2, -0.2, 0.3, 1.2, -1.3, 0.6, 0.6, 0.5, -0.1, -0.4, -0.2, -1.3, -0.7],
];
const H = [
  [0, 4545.4],
  [0, -3133.6, -815.1],
  [0, -56.6, 237.5, -549.5],
  [0, 278.6, -133.9, 212, -375.6],
  [0, 45.4, 220.2, -122.9, 43, 106.1],
  [0, -18.4, 16.8, 48.8, -59.8, 10.9, 72.7],
  [0, -48.9, -14.4, -1, 23.4, -7.4, -25.1, -2.3],
  [0, 7.1, -12.6, 11.4, -9.7, 12.7, 0.7, -5.2, 3.9],
  [0, -24.8, 12.2, 8.3, -3.3, -5.2, 7.2, -0.6, 0.8, 10],
  [0, 3.3, 0, 2.4, 5.3, -9.1, 0.4, -4.2, -3.8, 0.9, -9.1],
  [0, 0, 2.9, -0.6, 0.2, 0.5, -0.3, -1.2, -1.7, -2.9, -1.8, -2.3],
  [0, -1.3, 0.7, 1, -1.4, 0, 0.6, -0.1, 0.8, 0.1, -1, 0.1, 0.2],
];
const G_DOT = [
  [12, 9.7],
  [-11.6, -5.2, -8],
  [-1.3, -4.2, 0.4, -15.6],
  [-1.6, -2.4, -6, 5.6, -7],
  [0.6, 1.4, 0, 0.6, 2.2, 0.9],
  [-0.2, -0.4, 0.9, 1.2, -0.9, 0.3, 0.9],
  [0, -0.1, -0.1, 0.5, -0.1, -0.8, -0.8, 0.8],
  [-0.1, 0.2, 0, 0.5, -0.1, 0.3, 0.2, 0, 0.2],
  [0, -0.1, 0.1, 0.3, -0.3, 0, 0.3, -0.1, 0.1, -0.1],
  [0.1, 0, 0.1, 0.1, 0, -0.3, 0, -0.1, -0.1, 0, 0],
  [0, 0, 0, 0, 0, -0.1, 0, 0, -0.1, -0.1, -0.1, -0.1],
  [0, 0, 0, 0, 0, 0, 0.1, 0, 0, 0, -0.1, 0, -0.1],
];
const H_DOT = [
  [0, -21.5],
  [0, -27.7, -12.1],
  [0, 4, -0.3, -4.1],
  [0, -1.1, 4.1, 1.6, -4.4],
  [0, -0.5, 2.2, 0.4, 1.7, 1.9],
  [0, 0.3, -1.6, -0.4, 0.9, 0.7, 0.9],
  [0, 0.6, 0.5, -0.8, 0, -1, 0.6, -0.2],
  [0, -0.2, 0.5, -0.4, 0.4, -0.5, -0.6, 0.3, 0.2],
  [0, -0.3, 0.3, -0.3, 0.3, 0.2, -0.1, -0.2, 0.4, 0.1],
  [0, 0, 0, -0.2, 0.1, -0.1, 0.1, 0, -0.1, 0.2, 0],
  [0, 0, 0.1, 0, 0.1, 0, 0, 0.1, 0, 0, 0, 0],
  [0, 0, 0, -0.1, 0.1, 0, 0, 0, 0, 0, 0, 0, -0.1],
];

const N = 12;
const RAD = Math.PI / 180;
/** WGS 84 semi-major axis and flattening, km; the model's reference radius. */
const A = 6378.137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const REF = 6371.2;

/** Schmidt quasi-normalisation, per n and m. */
const SCHMIDT: number[][] = [[1]];
for (let n = 1; n <= N; n++) {
  const row = [SCHMIDT[n - 1][0] * ((2 * n - 1) / n)];
  for (let m = 1; m <= n; m++)
    row.push(row[m - 1] * Math.sqrt(((n - m + 1) * (m === 1 ? 2 : 1)) / (n + m)));
  SCHMIDT.push(row);
}

/** The year as a decimal, as the model counts time. */
export const decimalYear = (ms: number) => {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  return y + (ms - start) / (Date.UTC(y + 1, 0, 1) - start);
};

/**
 * Declination in degrees, east positive, at a point on the ground (`altKm` above the
 * ellipsoid) at a decimal year.
 */
export function declination(p: LngLat, year: number, altKm = 0): number {
  const t = year - EPOCH;
  const lat = p.lat * RAD;
  const lon = p.lng * RAD;
  // Geodetic to geocentric.
  const sinLat = Math.sin(lat);
  const rc = A / Math.sqrt(1 - E2 * sinLat * sinLat);
  const xy = (rc + altKm) * Math.cos(lat);
  const z = (rc * (1 - E2) + altKm) * sinLat;
  const r = Math.hypot(xy, z);
  const latC = Math.asin(z / r);
  const ct = Math.sin(latC);
  // Kept off zero at the poles, where east is undefined anyway.
  const st = Math.max(Math.cos(latC), 1e-9);

  // Gauss-normalised Legendre functions of the colatitude and their derivatives.
  const P: number[][] = [[1]];
  const dP: number[][] = [[0]];
  for (let n = 1; n <= N; n++) {
    P.push([]);
    dP.push([]);
    for (let m = 0; m <= n; m++) {
      if (n === m) {
        P[n][m] = st * P[n - 1][m - 1];
        dP[n][m] = st * dP[n - 1][m - 1] + ct * P[n - 1][m - 1];
      } else {
        const k = n > 1 && m <= n - 2 ? ((n - 1) ** 2 - m * m) / ((2 * n - 1) * (2 * n - 3)) : 0;
        const p2 = k ? P[n - 2][m] : 0;
        const dp2 = k ? dP[n - 2][m] : 0;
        P[n][m] = ct * P[n - 1][m] - k * p2;
        dP[n][m] = ct * dP[n - 1][m] - st * P[n - 1][m] - k * dp2;
      }
    }
  }

  let north = 0;
  let east = 0;
  let down = 0;
  for (let n = 1; n <= N; n++) {
    const ar = (REF / r) ** (n + 2);
    for (let m = 0; m <= n; m++) {
      const g = G[n - 1][m] + t * G_DOT[n - 1][m];
      const h = H[n - 1][m] + t * H_DOT[n - 1][m];
      const cm = Math.cos(m * lon);
      const sm = Math.sin(m * lon);
      const s = SCHMIDT[n][m];
      const along = g * cm + h * sm;
      north += ar * along * s * dP[n][m];
      east += (ar * m * (g * sm - h * cm) * s * P[n][m]) / st;
      down -= (n + 1) * ar * along * s * P[n][m];
    }
  }
  // Geocentric north to geodetic north: turned by the difference of the latitudes.
  const psi = latC - lat;
  const x = north * Math.cos(psi) - down * Math.sin(psi);
  return Math.atan2(east, x) / RAD;
}
