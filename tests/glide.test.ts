import { describe, expect, it } from 'vitest';
import { AHEAD_S, glideStep, settled, type Aim, type Shown } from '../src/core/glide';
import { track } from '../src/core/nav';
import type { Route } from '../src/core/route';

const O = { lng: 13.4, lat: 52.5 };
const m = (east: number, north: number): [number, number] => [
  O.lng + east / (111_320 * Math.cos((O.lat * Math.PI) / 180)),
  O.lat + north / 111_320,
];
// 2 km straight north.
const route: Route = {
  coords: [m(0, 0), m(0, 2000)],
  distance: 2000,
  duration: 200,
  bbox: [0, 0, 0, 0],
  maneuvers: [],
};
const tr = track(route);
const FRAME = 1000 / 60;

/** Frames from 0 to `ms`, fixes at the times given (driving `v` m/s, fix along = truth). */
function run(fixTimes: number[], ms: number, v = 10, along = (t: number) => (v * t) / 1000) {
  const frames: Shown[] = [];
  let shown: Shown | null = null;
  let aim: Aim | null = null;
  const fixes = [...fixTimes];
  for (let t = 0; t <= ms; t += FRAME) {
    while (fixes.length && fixes[0] <= t) {
      const at = fixes.shift()!;
      const a = along(at);
      aim = { along: a, point: m(0, a), speed: v, bearing: 0, at: t };
    }
    if (!aim) continue;
    shown = glideStep(shown, aim, t, tr);
    frames.push(shown);
  }
  return frames;
}

/** The longest stretch of frames the arrow stays put, ms. */
function longestStill(frames: Shown[]) {
  let still = 0;
  let worst = 0;
  for (let i = 1; i < frames.length; i++) {
    still = frames[i].along! - frames[i - 1].along! < 0.01 ? still + FRAME : 0;
    worst = Math.max(worst, still);
  }
  return worst;
}

describe('glide', () => {
  it('runs on between fixes a second apart, never standing', () => {
    const frames = run([0, 1000, 2000, 3000, 4000, 5000], 5500);
    expect(longestStill(frames)).toBe(0);
    // About the speed driven each frame once under way, not a burst then a wait.
    const pace = frames.slice(60).map((f, i) => (f.along! - frames[59 + i].along!) / FRAME);
    expect(Math.min(...pace)).toBeGreaterThan(0.007);
    expect(Math.max(...pace)).toBeLessThan(0.013);
    // Close to where the car really is.
    expect(Math.abs(frames.at(-1)!.along! - 55)).toBeLessThan(3);
  });

  it('keeps going through doubled, late and bunched fixes', () => {
    // The same fix twice, one late, two at once: as Android's providers send them.
    const frames = run([0, 1000, 1050, 2400, 2450, 3000, 4100, 4120, 5000], 5500);
    expect(longestStill(frames)).toBe(0);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].along!).toBeGreaterThanOrEqual(frames[i - 1].along!);
    }
  });

  it('stops after running on without a fix for a while', () => {
    const frames = run([0, 1000], 1000 + AHEAD_S * 1000 + 3000);
    const end = frames.at(-1)!.along!;
    expect(end).toBeLessThan(10 + 10 * AHEAD_S + 1);
    expect(frames.at(-60)!.along!).toBeCloseTo(end, 1);
    // Nothing more to draw then: the loop of frames ends.
    const aim: Aim = { along: 10, point: m(0, 10), speed: 10, bearing: 0, at: 1000 };
    expect(settled(frames.at(-1)!, aim, 1000 + AHEAD_S * 1000 + 3000)).toBe(true);
    expect(settled(frames.at(-1)!, aim, 1500)).toBe(false);
  });

  it('comes to rest at the fix when standing', () => {
    const aim: Aim = { along: 100, point: m(0, 100), speed: 0, bearing: 0, at: 0 };
    let shown = glideStep(null, { ...aim, along: 95, point: m(0, 95) }, 0, tr);
    for (let t = FRAME; t < 8000; t += FRAME) shown = glideStep(shown, aim, t, tr);
    expect(shown.along!).toBeCloseTo(100, 1);
    expect(settled(shown, aim, 8000)).toBe(true);
  });

  it('goes to a far fix at once', () => {
    const a = glideStep(null, { along: 0, point: m(0, 0), speed: 10, bearing: 0, at: 0 }, 0, tr);
    const b = glideStep(a, { along: 900, point: m(0, 900), speed: 10, bearing: 0, at: 16 }, 16, tr);
    expect(b.along).toBe(900);
  });

  it('comes to rest after a fix too fast to believe', () => {
    // A test's GPS (or a bad fix) jumping hundreds of metres a quarter second.
    const aim: Aim = { along: 400, point: m(0, 400), speed: 1200, bearing: 0, at: 16 };
    let shown = glideStep(null, { ...aim, along: 0, point: m(0, 0), at: 0 }, 0, tr);
    let t = 16;
    for (; t < 20_000 && !settled(shown, aim, t); t += FRAME) shown = glideStep(shown, aim, t, tr);
    expect(t).toBeLessThan(10_000);
    expect(shown.along!).toBeLessThan(400 + 70 * AHEAD_S + 1);
  });

  it('runs on along its course off the route, and turns smoothly', () => {
    const aim: Aim = { along: null, point: m(50, 0), speed: 10, bearing: 90, at: 0 };
    let shown = glideStep(null, { ...aim, bearing: 0 }, 0, null);
    const east: number[] = [];
    const heading: number[] = [];
    for (let t = FRAME; t < 1000; t += FRAME) {
      shown = glideStep(shown, aim, t, null);
      east.push(shown.point[0]);
      heading.push(shown.heading);
    }
    for (let i = 1; i < east.length; i++) expect(east[i]).toBeGreaterThan(east[i - 1]);
    expect(heading[0]).toBeLessThan(10);
    expect(heading.at(-1)!).toBeGreaterThan(80);
  });
});
