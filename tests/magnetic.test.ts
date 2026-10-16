import { describe, expect, it } from 'vitest';
import { decimalYear, declination } from '../src/core/magnetic';

/** NOAA's WMM2025 test values: year, altitude km, lat, lon, declination°. */
const NOAA = [
  [2025.0, 48, 80, -96, -29.91],
  [2025.0, 3, -50, -103, 27.96],
  [2025.5, 6, -36, -137, 20.28],
  [2025.5, 8, -52, -75, 14.91],
  [2025.5, 44, 33, -118, 11.1],
  [2026.0, 33, -3, -147, 9.71],
  [2026.0, 34, -19, 43, -14.98],
  [2026.5, 64, 10, 78, -1.53],
  [2026.5, 19, 29, 66, 2.24],
  [2027.0, 44, 22, 174, 6.46],
  [2027.0, 12, -63, 178, 57.87],
  [2027.5, 8, 62, 53, 19.39],
  [2027.5, 60, 27, 65, 1.85],
  [2027.5, 16, 66, -178, 0.37],
  [2028.0, 30, -36, -64, -4.65],
  [2028.0, 45, -46, -41, -11.68],
  [2028.5, 39, -65, -88, 29.45],
  [2028.5, 59, 32, 163, 0.15],
  [2029.0, 95, -70, 42, -55.06],
  [2029.0, 49, -50, -179, 32.11],
  [2029.5, 31, 13, -132, 9.04],
  [2029.5, 26, -65, 55, -63.48],
  [2029.5, 77, -18, 138, 4.45],
];

describe('magnetic declination', () => {
  it('matches NOAA test values', () => {
    for (const [year, alt, lat, lng, d] of NOAA) {
      expect(Math.abs(declination({ lng, lat }, year, alt) - d)).toBeLessThan(0.011);
    }
  });

  it('is a few degrees east in central Europe, west on the US east coast', () => {
    expect(declination({ lng: 13.4, lat: 52.52 }, 2026.8)).toBeGreaterThan(4);
    expect(declination({ lng: 13.4, lat: 52.52 }, 2026.8)).toBeLessThan(6.5);
    expect(declination({ lng: -74, lat: 40.7 }, 2026.8)).toBeLessThan(-11);
  });

  it('counts the year as the model does', () => {
    expect(decimalYear(Date.UTC(2026, 0, 1))).toBe(2026);
    expect(decimalYear(Date.UTC(2026, 6, 2, 12))).toBeCloseTo(2026.5, 2);
  });
});
