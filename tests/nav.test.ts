import { describe, expect, it } from 'vitest';
import {
  sayable,
  SAY_MAX_AGE_MS,
  initialNav,
  markReroute,
  markSpoken,
  navZoom,
  pointAt,
  prompt,
  rerouteDue,
  snap,
  step,
  track,
  type Fix,
  type NavState,
  headingToRoute,
  COURSE_KEEP_MS,
  courseOf,
} from '../src/core/nav';
import { buzzFor } from '../src/core/haptics';
import type { Mode, Route } from '../src/core/route';

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
  const said: { text: string; along: number; distance?: number }[] = [];
  points.forEach((p, i) => {
    st = step(tr, st, fixAt(p, i * 1000));
    const pr = prompt(tr, st, 'car');
    if (pr) {
      said.push({ text: pr.text, along: Math.round(st.snap!.along), distance: pr.distance });
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
      'Head north.',
      'Turn right onto B.',
      'Turn right onto B now.',
      'Continue for 500 meters.',
      'You have arrived.',
    ]);
    const [, alert, pre] = said;
    expect(1000 - alert.along).toBeLessThanOrEqual(600);
    expect(1000 - alert.along).toBeGreaterThan(150);
    expect(1000 - pre.along).toBeLessThanOrEqual(80);
    // The router's alert says no distance; the prompt carries it, the close one does not.
    expect(alert.distance).toBeCloseTo(1000 - alert.along, -1);
    expect(pre.distance).toBeUndefined();
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

  it('finds the point along the route, round its corner', () => {
    const at = (a: number) => pointAt(tr, a);
    expect(at(0).point).toEqual(m(0, 0));
    expect(at(500).point[1]).toBeCloseTo(m(0, 500)[1], 7);
    expect(at(500).bearing).toBeCloseTo(0, 0);
    // 1000 m north, then east: 1200 m in is 200 m east of the corner, not across it.
    expect(at(1200).point[0]).toBeCloseTo(m(200, 1000)[0], 6);
    expect(at(1200).point[1]).toBeCloseTo(m(200, 1000)[1], 6);
    expect(at(1200).bearing).toBeCloseTo(90, 0);
    // Beyond either end: held at the end.
    expect(at(-5).point).toEqual(m(0, 0));
    expect(at(9999).point[0]).toBeCloseTo(m(500, 1000)[0], 7);
  });

  it('zooms out with speed', () => {
    expect(navZoom(3)).toBeGreaterThan(navZoom(15));
    expect(navZoom(15)).toBeGreaterThan(navZoom(35));
  });

  it('stands still without GPS jitter turning into speed or heading changes', () => {
    // No device speed; the fix wanders up to 5 m around one spot for a minute.
    let st = initialNav();
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 10 - 5;
    for (let t = 0; t <= 60; t++) {
      const f = { ...fixAt(m(rand(), 300 + rand()), t * 1000), speed: null, accuracy: 10 };
      st = step(tr, st, f);
      expect(st.moving).toBe(false);
    }
    expect(st.speed).toBeLessThan(1);
  });

  it('counts as moving above 3 m/s and stops below 1.5, not in between', () => {
    let st = initialNav();
    let along = 0;
    const drive = (mps: number, seconds: number) => {
      for (let i = 0; i < seconds; i++) {
        along += mps;
        st = step(tr, st, { ...fixAt(m(0, along), st.time + 1000), speed: null, accuracy: 5 });
      }
    };
    drive(10, 10);
    expect(st.moving).toBe(true);
    // Slowing to 2 m/s keeps the route's heading (hysteresis) ...
    drive(2, 20);
    expect(st.moving).toBe(true);
    // ... down to a crawl hands it to the compass.
    drive(0.5, 30);
    expect(st.moving).toBe(false);
  });
});

/** A route along the given points (metres from O), one maneuver at each corner. */
function routeThrough(points: [number, number][], kinds: { type: number; text: string }[]): Route {
  const coords = points.map(([e, n]) => m(e, n));
  let along = 0;
  const lengths = points.slice(1).map(([e, n], i) => {
    const d = Math.hypot(e - points[i][0], n - points[i][1]);
    along += d;
    return d;
  });
  return {
    coords,
    distance: along,
    duration: along / 10,
    bbox: [0, 0, 0, 0],
    maneuvers: kinds.map((k, i) => ({
      type: k.type,
      instruction: k.text,
      pre: k.text,
      alert: i > 0 && i < kinds.length - 1 ? k.text : undefined,
      distance: lengths[i] ?? 0,
      duration: (lengths[i] ?? 0) / 10,
      begin: i,
    })),
  };
}

/** Feeds fixes one second apart, speaking prompts; returns what was said and the states. */
function replay(r: Route, fixes: [number, number][], speed: number | null, mode: Mode = 'car') {
  const t = track(r, mode);
  let st = initialNav();
  const said: string[] = [];
  const states: NavState[] = [];
  fixes.forEach((p, i) => {
    st = step(t, st, { ...fixAt(p, i * 1000, speed ?? undefined), speed });
    const pr = prompt(t, st, mode);
    if (pr) {
      said.push(pr.distance ? `${Math.round(pr.distance)}|${pr.text}` : pr.text);
      st = markSpoken(st, pr.key);
    }
    states.push(st);
  });
  return { said, states };
}

describe('arrival', () => {
  const r = routeThrough(
    [
      [0, 0],
      [0, 2000],
    ],
    [
      { type: 1, text: 'Head north.' },
      { type: 4, text: 'You have arrived.' },
    ],
  );

  it('is said on arriving, not on the way there', () => {
    const fixes: [number, number][] = [];
    for (let d = 0; d <= 2000; d += 25) fixes.push(m(0, d));
    const { said, states } = replay(r, fixes, 25);
    expect(said).toEqual(['Head north.', 'You have arrived.']);
    const at = states.findIndex((s) => s.arrived);
    expect(2000 - states[at].snap!.along).toBeLessThan(25);
  });

  it('stays arrived when the fix wanders off at the door', () => {
    const fixes: [number, number][] = [
      m(0, 1950),
      m(0, 1990),
      m(0, 2000),
      m(80, 1990),
      m(90, 1950),
    ];
    const { states } = replay(r, fixes, 2);
    expect(states.at(-1)!.arrived).toBe(true);
    expect(states.at(-1)!.offRoute).toBe(false);
  });
});

describe('a route that crosses itself', () => {
  // North 500, east 200, south 300, west 400: the last leg crosses the first at 200 m.
  const r = routeThrough(
    [
      [0, 0],
      [0, 500],
      [200, 500],
      [200, 200],
      [-200, 200],
    ],
    [
      { type: 1, text: 'Head north.' },
      { type: 10, text: 'Turn right.' },
      { type: 10, text: 'Turn right again.' },
      { type: 10, text: 'Turn right a third time.' },
      { type: 4, text: 'You have arrived.' },
    ],
  );

  it('does not jump to the later leg at the crossing', () => {
    const fixes: [number, number][] = [];
    for (let d = 0; d <= 500; d += 10) fixes.push(m(d === 200 ? 3 : 0, d));
    const { states, said } = replay(r, fixes, 10);
    const atCrossing = states[20];
    expect(atCrossing.snap!.along).toBeCloseTo(200, -1);
    expect(atCrossing.next).toBe(1);
    expect(said.some((s) => s.includes('Turn right.'))).toBe(true);
  });
});

describe('a U-turn onto the other carriageway', () => {
  // North 1000 m, then back south 16 m to the east.
  const r = routeThrough(
    [
      [0, 0],
      [0, 1000],
      [16, 1000],
      [16, 0],
    ],
    [
      { type: 1, text: 'Head north.' },
      { type: 12, text: 'Make a U-turn.' },
      { type: 15, text: 'Continue.' },
      { type: 4, text: 'You have arrived.' },
    ],
  );

  it('keeps to the carriageway being driven when a fix strays toward the other', () => {
    const fixes: [number, number][] = [];
    for (let d = 0; d <= 400; d += 10) fixes.push(m(d === 300 ? 9 : 0, d));
    const { states } = replay(r, fixes, 10);
    const s = states.at(-1)!;
    expect(s.snap!.along).toBeCloseTo(400, -1);
    expect(s.snap!.bearing).toBeCloseTo(0, 0);
    expect(s.next).toBe(1);
  });
});

describe('on a motorway', () => {
  const r = routeThrough(
    [
      [0, 0],
      [0, 5000],
      [1000, 5000],
    ],
    [
      { type: 1, text: 'Head north.' },
      { type: 20, text: 'Take the exit.' },
      { type: 4, text: 'You have arrived.' },
    ],
  );

  it('still warns early at 160 km/h', () => {
    const fixes: [number, number][] = [];
    for (let d = 0; d <= 5000; d += 44) fixes.push(m(0, d));
    const { said } = replay(r, fixes, 44);
    const alert = said.find((s) => s.endsWith('|Take the exit.'));
    expect(alert).toBeDefined();
    expect(Number(alert!.split('|')[0])).toBeGreaterThan(600);
  });
});

describe('fixes not to be trusted, turns not taken', () => {
  // North 1000 m, right 500 m, left 500 m.
  const r = routeThrough(
    [
      [0, 0],
      [0, 1000],
      [500, 1000],
      [500, 1500],
    ],
    [
      { type: 1, text: 'Head north.' },
      { type: 10, text: 'Turn right onto B.' },
      { type: 15, text: 'Turn left onto C.' },
      { type: 4, text: 'You have arrived.' },
    ],
  );
  const t = track(r);
  const at = (e: number, n: number, time: number, extra: Partial<Fix> = {}): Fix => ({
    ...fixAt(m(e, n), time),
    ...extra,
  });

  it('lets a coarse fix move neither progress nor the turn ahead', () => {
    let st = step(t, initialNav(), at(0, 200, 0));
    // A network fix 400 m ahead, give or take 400 m: guidance waits for a better one.
    st = step(t, st, at(0, 600, 1000, { accuracy: 400 }));
    expect(st.weak).toBe(true);
    expect(st.snap!.along).toBeCloseTo(200, -1);
    st = step(t, st, at(0, 230, 2000));
    expect(st.weak).toBe(false);
    expect(st.next).toBe(1);
    expect(st.toNext).toBeCloseTo(770, -1);
  });

  it('does not take a turn driven straight past, and says nothing off the route', () => {
    const fixes: [number, number][] = [];
    for (let n = 0; n <= 1300; n += 20) fixes.push(m(0, n));
    const { said, states } = replay(r, fixes, 10);
    const last = states.at(-1)!;
    expect(last.next).toBe(1);
    expect(last.offSince).not.toBeNull();
    expect(said.some((x) => x.includes('onto C'))).toBe(false);
  });

  it('keeps the turn ahead while waiting at the light just before it', () => {
    let st = initialNav();
    for (let i = 0; i < 50; i++) st = step(t, st, at(0, i * 20, i * 1000));
    // Standing 8 m before the corner for a minute, GPS wandering by metres.
    for (let i = 0; i < 60; i++) {
      st = step(t, st, at(i % 2 ? 3 : -3, 986 + (i % 3) * 6, (50 + i) * 1000, { speed: 0 }));
    }
    expect(st.next).toBe(1);
  });

  it('notices driving back down the route', () => {
    const fixes: [number, number][] = [];
    for (let n = 0; n <= 600; n += 20) fixes.push(m(0, n));
    for (let n = 580; n >= 300; n -= 20) fixes.push(m(0, n));
    const { states } = replay(r, fixes, 10);
    expect(states.at(-1)!.offRoute).toBe(true);
  });

  it('notices a course against the route', () => {
    let st = initialNav();
    for (let i = 0; i <= 10; i++) {
      st = step(t, st, at(0, i * 20, i * 1000, { speed: 15, heading: 0 }));
    }
    // Turned round across a wide road: heading south, on the same line.
    for (let i = 11; i <= 14; i++) {
      st = step(t, st, at(0, 200, i * 1000, { speed: 15, heading: 180 }));
    }
    expect(st.offSince).not.toBeNull();
  });

  it('does not count getting to the route from a car park as off it', () => {
    let st = initialNav();
    for (let i = 0; i <= 20; i++) st = step(t, st, at(120 - i * 5, 0, i * 1000, { speed: 3 }));
    expect(st.offRoute).toBe(false);
    expect(st.joined).toBe(true);
    // Driving away from the route instead is off it.
    let away = initialNav();
    for (let i = 0; i <= 30; i++) {
      away = step(t, away, at(120 + i * 10, -i * 5, i * 1000, { speed: 8 }));
    }
    expect(away.offRoute).toBe(true);
  });
});

describe('setting off', () => {
  it('says how the route sets off with the first fix on it', () => {
    const st = step(tr, initialNav(), fixAt(m(5, 0), 0));
    expect(prompt(tr, st, 'car')).toEqual({ key: '0:pre', text: 'Head north.' });
  });

  it('heads to a route that starts further off first, its own words once there', () => {
    // In a car park 120 m west of where the route starts.
    let st = step(tr, initialNav(), fixAt(m(-120, 0), 0, 3));
    expect(headingToRoute(st)).toBe(true);
    expect(st.toRoute).toBeCloseTo(120, -1);
    const head = prompt(tr, st, 'car');
    expect(head).toEqual({ key: '0:head', text: '', head: true });
    st = markSpoken(st, head!.key);
    st = step(tr, st, fixAt(m(-90, 0), 10_000, 3));
    expect(prompt(tr, st, 'car')).toBeNull();
    // On the road: off it goes.
    for (let i = 1; i <= 4; i++) st = step(tr, st, fixAt(m(-90 + i * 22, 0), (10 + i) * 1000, 3));
    expect(headingToRoute(st)).toBe(false);
    expect(prompt(tr, st, 'car')?.key).toBe('0:pre');
  });

  it('buzzes for no setting off', () => {
    const muted = (key: string) => buzzFor({ key, text: '' }, 'foot', true, 2);
    expect(muted('0:pre')).toBeNull();
    expect(muted('0:head')).toBeNull();
    expect(muted('1:pre')).not.toBeNull();
  });
});

describe('off the route by bike and on foot', () => {
  /** One fix a second, `east` metres beside the first leg, moving north at `speed`. */
  const beside = (t: ReturnType<typeof track>, east: number, speed: number, n = 20, acc = 8) => {
    let st = initialNav();
    for (let i = 0; i <= 10; i++) st = step(t, st, fixAt(m(0, i * speed), i * 1000, speed));
    for (let i = 1; i <= n; i++) {
      const fix = fixAt(m(east, (10 + i) * speed), (10 + i) * 1000, speed);
      st = step(t, st, { ...fix, accuracy: acc });
    }
    return st;
  };

  it('notices a walker on a path 25 m beside the route, which a car would not', () => {
    expect(beside(track(route, 'foot'), 25, 1.4).offRoute).toBe(true);
    expect(beside(track(route, 'car'), 25, 10).offRoute).toBe(false);
  });

  it('lets a walker drift with a poor fix, and walk the pavement with a good one', () => {
    expect(beside(track(route, 'foot'), 25, 1.4, 20, 25).offRoute).toBe(false);
    expect(beside(track(route, 'foot'), 12, 1.4).offRoute).toBe(false);
  });

  it('notices walking back down the route', () => {
    const fixes: [number, number][] = [];
    for (let n = 0; n <= 140; n += 1.4) fixes.push(m(0, n));
    for (let n = 140; n >= 70; n -= 1.4) fixes.push(m(0, n));
    const { states } = replay(route, fixes, 1.4, 'foot');
    expect(states.at(-1)!.offRoute).toBe(true);
  });

  it('notices a cyclist riding on past the turn, and one turned round', () => {
    const past: [number, number][] = [];
    for (let n = 0; n <= 1200; n += 5) past.push(m(0, n));
    const { states } = replay(route, past, 5, 'bike');
    expect(states.at(-1)!.offRoute).toBe(true);

    const t = track(route, 'bike');
    let st = initialNav();
    for (let i = 0; i <= 10; i++)
      st = step(t, st, { ...fixAt(m(0, i * 5), i * 1000, 5), heading: 0 });
    for (let i = 11; i <= 14; i++)
      st = step(t, st, { ...fixAt(m(0, 50), i * 1000, 5), heading: 180 });
    expect(st.offSince).not.toBeNull();
  });

  it('stays on the route riding it with GPS jitter', () => {
    const fixes: [number, number][] = [];
    for (let n = 0; n <= 1000; n += 5) fixes.push(m(n % 10 ? 8 : -8, n));
    const { states } = replay(route, fixes, 5, 'bike');
    expect(states.some((s) => s.offSince !== null)).toBe(false);
  });
});

describe('asking the router again', () => {
  const at = (e: number, n: number, time: number): Fix => fixAt(m(e, n), time);

  it('asks at most every 30 s while moving on', () => {
    const first = markReroute(null, at(0, 0, 0));
    expect(rerouteDue(first, at(0, 300, 20_000))).toBe(false);
    expect(rerouteDue(first, at(0, 300, 30_000))).toBe(true);
  });

  it('backs off standing in the same wrong place, and starts over once moving', () => {
    let mark = markReroute(null, at(0, 0, 0));
    expect(rerouteDue(mark, at(5, 0, 30_000))).toBe(false);
    expect(rerouteDue(mark, at(5, 0, 60_000))).toBe(true);
    mark = markReroute(mark, at(5, 0, 60_000));
    expect(mark.count).toBe(1);
    expect(rerouteDue(mark, at(5, 0, 150_000))).toBe(false);
    expect(rerouteDue(mark, at(5, 0, 180_000))).toBe(true);
    expect(markReroute(mark, at(0, 400, 200_000)).count).toBe(0);
  });
});

describe('sayable', () => {
  it('speaks about a fresh fix only, never one from a queue held up', () => {
    expect(sayable(1000, 1000 + 2000)).toBe(true);
    expect(sayable(1000, 1000 + SAY_MAX_AGE_MS)).toBe(false);
    // A fix stamped slightly ahead of the phone's clock is fresh.
    expect(sayable(5000, 4000)).toBe(true);
  });
});

describe('the way a reroute leaves in', () => {
  it('keeps the course last driven while standing in traffic, not for ever', () => {
    const moving = courseOf({ heading: 90, speed: 12 }, null, 1000);
    expect(moving).toEqual({ heading: 90, at: 1000 });
    // Stopped: GPS course is noise, the last one stands.
    expect(courseOf({ heading: 200, speed: 0.4 }, moving, 60_000)).toBe(moving);
    expect(courseOf({ heading: null, speed: 0 }, moving, 100_000)).toBe(moving);
    // Two minutes on, nobody knows which way the car faces any more.
    expect(courseOf({ heading: null, speed: 0 }, moving, 1000 + COURSE_KEEP_MS)).toBeNull();
    expect(courseOf({ heading: NaN, speed: 10 }, null, 0)).toBeNull();
  });
});
