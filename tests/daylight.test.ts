import { describe, expect, it } from 'vitest';
import { inTunnel, isNight, sunElevation } from '../src/core/daylight';

const BERLIN = { lat: 52.52, lng: 13.405 };
const utc = (s: string) => Date.parse(`${s}Z`);

describe('sun', () => {
  it('stands highest at solar noon on the solstice', () => {
    // Berlin, 21 June: solar noon about 11:07 UTC, 90 − 52.52 + 23.44 ≈ 60.9°.
    const e = sunElevation(BERLIN.lat, BERLIN.lng, utc('2024-06-21T11:07:00'));
    expect(e).toBeCloseTo(60.9, 0);
  });

  it('sets at the published time', () => {
    // Berlin sunset 21 June 2024: 21:33 CEST = 19:33 UTC.
    expect(isNight(BERLIN.lat, BERLIN.lng, utc('2024-06-21T19:25:00'))).toBe(false);
    expect(isNight(BERLIN.lat, BERLIN.lng, utc('2024-06-21T19:41:00'))).toBe(true);
    // Sunrise 22 June: 4:43 CEST = 2:43 UTC.
    expect(isNight(BERLIN.lat, BERLIN.lng, utc('2024-06-22T02:35:00'))).toBe(true);
    expect(isNight(BERLIN.lat, BERLIN.lng, utc('2024-06-22T02:51:00'))).toBe(false);
  });

  it('knows polar night and midnight sun', () => {
    // Tromsø.
    expect(isNight(69.65, 18.96, utc('2024-12-21T11:00:00'))).toBe(true);
    expect(isNight(69.65, 18.96, utc('2024-06-21T23:00:00'))).toBe(false);
  });

  it('follows longitude: noon in Sydney is night in Berlin', () => {
    const t = utc('2024-03-20T02:00:00');
    expect(isNight(-33.87, 151.21, t)).toBe(false);
    expect(isNight(BERLIN.lat, BERLIN.lng, t)).toBe(true);
  });
});

describe('tunnel', () => {
  // Metres east/north of the origin to [lng, lat].
  const m = (x: number, y: number): [number, number] => [x / 67800, 52 + y / 111200];
  const northSouth = [m(0, -300), m(0, 300)];

  it('counts a fix running along a tunnel', () => {
    expect(inTunnel(m(5, 0), 0, [northSouth])).toBe(true);
    expect(inTunnel(m(-5, 100), 180, [northSouth])).toBe(true);
  });

  it('ignores a road crossing over it', () => {
    expect(inTunnel(m(0, 0), 90, [northSouth])).toBe(false);
  });

  it('ignores a road beside it and one past its end', () => {
    expect(inTunnel(m(40, 0), 0, [northSouth])).toBe(false);
    expect(inTunnel(m(0, 340), 0, [northSouth])).toBe(false);
  });

  it('ignores short underpasses', () => {
    expect(inTunnel(m(0, 0), 0, [[m(0, -30), m(0, 30)]])).toBe(false);
  });

  it('measures the whole line, not the segment', () => {
    const bent = [m(0, -20), m(0, 20), m(100, 40), m(200, 40)];
    expect(inTunnel(m(0, 0), 0, [bent])).toBe(true);
  });
});
