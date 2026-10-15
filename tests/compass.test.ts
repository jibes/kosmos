import { describe, expect, it } from 'vitest';
import {
  angleDiff,
  headingOf,
  filterHeading,
  travelHeading,
  type OrientationReading,
  type HeadingFilter,
} from '../src/core/compass';

type M = number[][];
const RAD = Math.PI / 180;
const mul = (a: M, b: M): M =>
  a.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
const rotX = (d: number): M => {
  const [c, s] = [Math.cos(d * RAD), Math.sin(d * RAD)];
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
};
const rotZ = (d: number): M => {
  const [c, s] = [Math.cos(d * RAD), Math.sin(d * RAD)];
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
};

/**
 * A phone facing `heading` (its top lying flat, its back standing upright), tipped up from flat
 * by `pitch`, turned in its own plane by `roll` (90: sideways, top to the left), read out as
 * Chromium does (`ComputeOrientationEulerAnglesFromRotationMatrix`).
 */
function pose(heading: number, pitch: number, roll = 0): OrientationReading {
  const r = mul(mul(rotZ(-heading), rotX(pitch)), rotZ(roll)).flat();
  let alpha: number, beta: number, gamma: number;
  if (r[8] > 0) {
    alpha = Math.atan2(-r[1], r[4]);
    beta = Math.asin(r[7]);
    gamma = Math.atan2(-r[6], r[8]);
  } else {
    alpha = Math.atan2(r[1], -r[4]);
    beta = -Math.asin(r[7]);
    beta += beta >= 0 ? -Math.PI : Math.PI;
    gamma = Math.atan2(r[6], -r[8]);
  }
  const deg = (v: number) => v / RAD;
  return { alpha: (deg(alpha) + 360) % 360, beta: deg(beta), gamma: deg(gamma), absolute: true };
}

const norm360 = (d: number) => ((d % 360) + 360) % 360;

/** How far a heading is from the expected one, either way round. */
const off = (h: number | null, want: number) => Math.abs(angleDiff(want, h ?? NaN));

describe('compass', () => {
  it('turns alpha into a clockwise heading', () => {
    expect(headingOf({ alpha: 0, absolute: true })).toBe(0);
    expect(headingOf({ alpha: 90, absolute: true })).toBe(270);
    expect(headingOf({ alpha: 270, absolute: true })).toBe(90);
  });

  it('corrects for a rotated screen', () => {
    expect(headingOf({ alpha: 0, absolute: true }, 90)).toBe(90);
    expect(headingOf({ alpha: 10, absolute: true }, 270)).toBe(260);
  });

  it('reads the top of the screen while the phone lies flat, also turned sideways', () => {
    for (const h of [0, 45, 90, 200, 315]) {
      expect(off(headingOf(pose(h, 0)), h)).toBeLessThan(0.01);
      expect(off(headingOf(pose(h, 0, 90), 90), h)).toBeLessThan(0.01);
      expect(off(headingOf(pose(h, 0, -90), 270), h)).toBeLessThan(0.01);
    }
  });

  it('reads the back of an upright phone, like a torch, also slightly rolled', () => {
    // Upright and rolled 10°: the top edge leans sideways, and alpha alone was 79° off.
    const torch = pose(0, 88, 10);
    expect(off(norm360(360 - torch.alpha!), 0)).toBeGreaterThan(75);
    expect(off(headingOf(torch), 0)).toBeLessThan(2);
    for (const h of [0, 90, 180, 270]) {
      // Tipped up any amount: top and back agree.
      for (const pitch of [20, 45, 60, 80, 90, 100]) {
        expect(off(headingOf(pose(h, pitch)), h)).toBeLessThan(0.5);
      }
      // Near upright, a roll leaves where the back points; alpha alone was 45–90° off.
      for (const pitch of [80, 85, 90, 95, 100]) {
        for (const roll of [-15, 15]) {
          const p = pose(h, pitch, roll);
          expect(off(headingOf(p), h)).toBeLessThan(5);
          expect(off(norm360(360 - p.alpha!), h)).toBeGreaterThan(45);
        }
      }
      // Upright in landscape, as for a photo.
      expect(off(headingOf(pose(h, 85, 90), 90), h)).toBeLessThan(2);
    }
  });

  it('is steady where alpha and gamma trade places (standing exactly upright)', () => {
    expect(off(headingOf({ alpha: 60, beta: 90, gamma: -60, absolute: true }), 0)).toBeLessThan(
      0.01,
    );
    expect(off(headingOf({ alpha: 0, beta: 90, gamma: 0, absolute: true }), 0)).toBeLessThan(0.01);
  });

  it('prefers Safari compass heading and ignores relative readings', () => {
    expect(headingOf({ alpha: 123, absolute: false, webkitCompassHeading: 45 })).toBe(45);
    expect(headingOf({ alpha: 123, absolute: false })).toBeNull();
    expect(headingOf({ alpha: null, absolute: true })).toBeNull();
  });

  it('measures the short way round', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(angleDiff(0, 180)).toBe(180);
  });

  // A phone held still: the magnetometer's jitter, here up to ±4° on every reading.
  const noisy = (hz: number, seconds: number, at: number, seed = 7) => {
    let r = seed;
    const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647) * 2 - 1;
    return Array.from({ length: hz * seconds }, (_, i) => ({
      raw: at + 4 * rand(),
      time: (i * 1000) / hz,
    }));
  };
  const run = (readings: { raw: number; time: number }[], from: HeadingFilter | null = null) => {
    let f = from;
    const out: number[] = [];
    for (const { raw, time } of readings) {
      f = filterHeading(f, raw, time);
      out.push(f.heading);
    }
    return { f: f!, out };
  };
  const spread = (hs: number[]) =>
    Math.max(...hs.map((h) => angleDiff(hs[0], h))) -
    Math.min(...hs.map((h) => angleDiff(hs[0], h)));

  it('holds still when the phone does, whatever the readings per second', () => {
    for (const hz of [10, 20, 60]) {
      const { out } = run(noisy(hz, 4, 120));
      // After the first second: the beam drifts by under two degrees all told, not ±4° on
      // every reading (smoothing each reading by a quarter left 3–5°).
      expect(spread(out.slice(hz))).toBeLessThan(1.8);
    }
  });

  it('follows a real turn quickly, and settles where it ends', () => {
    const hz = 60;
    const still = noisy(hz, 2, 0);
    // A quarter turn in half a second, then still again.
    const turn = Array.from({ length: hz / 2 }, (_, i) => ({
      raw: 180 * ((i + 1) / hz),
      time: 2000 + ((i + 1) * 1000) / hz,
    }));
    const after = noisy(hz, 2, 90).map((r) => ({ ...r, time: r.time + 2500 }));
    const { f } = run(still);
    const mid = run(turn, f);
    // Half a second after the turn began it is most of the way there.
    expect(angleDiff(0, mid.f.heading)).toBeGreaterThan(60);
    const end = run(after, mid.f);
    // Half a second after the turn ended, within a few degrees of where it stopped.
    expect(Math.abs(angleDiff(end.out[hz / 2], 90))).toBeLessThan(6);
  });

  it('smooths across north without spinning', () => {
    expect(filterHeading(null, 370, 0).heading).toBe(10);
    const f = run([350, 10, 350, 10, 350, 10].map((raw, i) => ({ raw, time: i * 50 }))).f;
    expect(Math.abs(angleDiff(0, f.heading))).toBeLessThan(10);
  });

  it('uses the compass when not moving and the course when moving', () => {
    expect(travelHeading(90, 180, false)).toBe(180);
    expect(travelHeading(90, 180, true)).toBe(90);
    expect(travelHeading(null, 180, true)).toBe(180);
    expect(travelHeading(90, null, false)).toBe(90);
  });
});
