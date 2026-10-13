import { describe, expect, it } from 'vitest';
import {
  initialNav,
  markSpoken,
  navZoom,
  prompt,
  snap,
  step,
  track,
  type Fix,
  type NavState,
} from '../src/core/nav';
import type { Route } from '../src/core/route';

const O = { lng: 13.4, lat: 52.5 };
/** A point `east`/`north` metres from O. */
const m = (east: number, north: number): [number, number] => [
  O.lng + east / (111_195 * Math.cos((O.lat * Math.PI) / 180)),
  O.lat + north / 111_195,
];

// 1000 m north, turn right, 500 m east.
const route: Route = {
  coords: [m(0, 0), m(0, 1000), m(500, 1000)],
  distance: 1500,
  duration: 150,
  bbox: [0, 0, 0, 0],
  maneuvers: [
    {
      type: 1,
      instruction: 'Head north.',
      pre: 'Head north.',
      distance: 1000,
      duration: 100,
      begin: 0,
    },
    {
      type: 10,
      instruction: 'Turn right onto B.',
      alert: 'Turn right onto B.',
      pre: 'Turn right onto B now.',
      post: 'Continue for 500 meters.',
      distance: 500,
      duration: 50,
      begin: 1,
    },
    {
      type: 4,
      instruction: 'Arrive.',
      pre: 'You have arrived.',
      distance: 0,
      duration: 0,
      begin: 2,
    },
  ],
};
const tr = track(route);

const fixAt = ([lng, lat]: [number, number], time: number, speed = 10): Fix => ({
  lng,
  lat,
  accuracy: 8,
  speed,
  time,
});

/** Drives the route at 10 m/s, one fix per second, speaking every prompt as it comes. */
function drive(points: [number, number][]) {
  let st: NavState = initialNav();
  const said: { text: string; along: number }[] = [];
  points.forEach((p, i) => {
    st = step(tr, st, fixAt(p, i * 1000));
    const pr = prompt(tr, st, 'car');
    if (pr) {
      said.push({ text: pr.text, along: Math.round(st.snap!.along) });
      st = markSpoken(st, pr.key);
    }
  });
  return { st, said };
}

const path = (): [number, number][] => {
  const pts: [number, number][] = [];
  for (let d = 0; d <= 1000; d += 10) pts.push(m(d % 20 ? 3 : -3, d)); // ±3 m GPS jitter
  for (let d = 10; d <= 500; d += 10) pts.push(m(d, 1000 + (d % 20 ? 2 : -2)));
  return pts;
};

describe('track and snap', () => {
  it('measures the route in metres', () => {
    expect(tr.along.at(-1)).toBeCloseTo(1500, -1);
    expect(tr.at).toEqual([0, tr.along[1], tr.along[2]]);
    expect(tr.timeLeft).toEqual([50, 0, 0]);
  });

  it('projects a fix onto the nearest segment', () => {
    const s = snap(tr, { lng: m(20, 400)[0], lat: m(20, 400)[1] });
    expect(s.along).toBeCloseTo(400, -1);
    expect(s.offset).toBeCloseTo(20, 0);
    expect(s.segment).toBe(0);
    expect(s.bearing).toBeCloseTo(0, 0);
    const e = snap(tr, { lng: m(250, 990)[0], lat: m(250, 990)[1] });
    expect(e.segment).toBe(1);
    expect(e.bearing).toBeCloseTo(90, 0);
  });
});

describe('guidance', () => {
  it('announces each maneuver once, in order, and arrives', () => {
    const { st, said } = drive(path());
    expect(said.map((s) => s.text)).toEqual([
      'Turn right onto B.',
      'Turn right onto B now.',
      'Continue for 500 meters.',
      'You have arrived.',
    ]);
    const [alert, pre] = said;
    expect(1000 - alert.along).toBeLessThanOrEqual(600);
    expect(1000 - alert.along).toBeGreaterThan(150);
    expect(1000 - pre.along).toBeLessThanOrEqual(80);
    expect(st.arrived).toBe(true);
    expect(st.offRoute).toBe(false);
  });

  it('counts down distance and time to the destination', () => {
    let st = initialNav();
    st = step(tr, st, fixAt(m(0, 200), 0));
    expect(st.next).toBe(1);
    expect(st.toNext).toBeCloseTo(800, -1);
    expect(st.remaining).toBeCloseTo(1300, -1);
    expect(st.eta).toBeCloseTo(130, 0);
    st = step(tr, st, fixAt(m(100, 1000), 1000));
    expect(st.next).toBe(2);
    expect(st.eta).toBeCloseTo(40, 0);
  });

  it('reroutes only after staying off the route', () => {
    let st = initialNav();
    st = step(tr, st, fixAt(m(0, 100), 0));
    // A 5 s excursion 120 m away is noise.
    for (let t = 1; t <= 5; t++) st = step(tr, st, fixAt(m(120, 100 + t * 10), t * 1000));
    expect(st.offRoute).toBe(false);
    st = step(tr, st, fixAt(m(0, 170), 6000));
    expect(st.offSince).toBeNull();
    // Ten seconds away is a wrong turn.
    for (let t = 7; t <= 17; t++) st = step(tr, st, fixAt(m(150, 170), t * 1000));
    expect(st.offRoute).toBe(true);
  });

  it('tolerates a poor fix', () => {
    let st = initialNav();
    st = step(tr, st, { ...fixAt(m(60, 300), 0), accuracy: 50 });
    expect(st.offSince).toBeNull();
  });

  it('estimates speed when the device does not report it', () => {
    let st = initialNav();
    st = step(tr, st, { ...fixAt(m(0, 100), 0), speed: null });
    st = step(tr, st, { ...fixAt(m(0, 120), 1000), speed: null });
    st = step(tr, st, { ...fixAt(m(0, 140), 2000), speed: null });
    expect(st.speed).toBeGreaterThan(10);
    expect(st.speed).toBeLessThan(25);
  });

  it('zooms out with speed', () => {
    expect(navZoom(3)).toBeGreaterThan(navZoom(15));
    expect(navZoom(15)).toBeGreaterThan(navZoom(35));
  });
});
