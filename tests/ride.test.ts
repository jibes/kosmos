import { describe, expect, it } from 'vitest';
import {
  FRESH_MS,
  initialRide,
  markRideSpoken,
  ridePrompt,
  rideStep,
  type Fix,
} from '../src/core/ride';
import { encodePolyline } from '../src/core/route';
import { parseMotis, type Transit } from '../src/core/transit';

// Metres east/north of a point in Berlin to [lng, lat].
const m = (x: number, y: number): [number, number] => [13.4 + x / 67800, 52.5 + y / 111200];
const T0 = Date.parse('2026-10-13T12:00:00Z');
const min = (n: number) => T0 + n * 60_000;
const iso = (n: number) => new Date(min(n)).toISOString();
const at = (p: [number, number], t: number): Fix => ({ lng: p[0], lat: p[1], time: t });

// Walk 400 m north to the stop, U6 east 3 km with two stops between, walk 300 m south.
const start = m(0, 0);
const s1 = m(0, 400);
const v1 = m(1000, 400);
const v2 = m(2000, 400);
const s2 = m(3000, 400);
const end = m(3000, 100);
const place = (p: [number, number], name: string, extra = {}) => ({
  name,
  lon: p[0],
  lat: p[1],
  ...extra,
});
const leg = (
  mode: string,
  a: [number, number],
  b: [number, number],
  t0: number,
  t1: number,
  extra = {},
) => ({
  mode,
  from: place(a, 'from'),
  to: place(b, 'to'),
  startTime: iso(t0),
  endTime: iso(t1),
  legGeometry: { points: encodePolyline([a, b]), precision: 6 },
  ...extra,
});
const transit: Transit = parseMotis({
  itineraries: [
    {
      startTime: iso(0),
      endTime: iso(24),
      duration: 24 * 60,
      transfers: 0,
      legs: [
        leg('WALK', start, s1, 0, 6, {
          distance: 400,
          steps: [
            { relativeDirection: 'DEPART', distance: 250, streetName: 'Friedrichstraße' },
            { relativeDirection: 'CONTINUE', distance: 100 },
            { relativeDirection: 'RIGHT', distance: 50, streetName: 'Bahnhofsvorplatz' },
          ],
        }),
        leg('SUBWAY', s1, s2, 8, 20, {
          displayName: 'U6',
          headsign: 'Alt-Tegel',
          legGeometry: { points: encodePolyline([s1, v1, v2, s2]), precision: 6 },
          intermediateStops: [
            place(v1, 'One', { arrival: iso(12) }),
            place(v2, 'Two', { arrival: iso(16) }),
          ],
        }),
        leg('WALK', s2, end, 20, 24, { distance: 300 }),
      ],
    },
  ],
})[0].transit!;

/** Steps through fixes and time, saying every prompt as the app would. */
function replay(steps: { fix: Fix | null; time: number }[]) {
  let st = initialRide(transit, steps[0].time, steps[0].fix);
  const said: string[] = [];
  const say = () => {
    const p = ridePrompt(transit, st);
    if (p) {
      said.push(p.key);
      st = markRideSpoken(st, p.key);
    }
  };
  say();
  for (const s of steps.slice(1)) {
    st = rideStep(transit, st, s.fix, s.time);
    say();
  }
  return { st, said };
}

describe('ride', () => {
  it('starts by walking to the stop', () => {
    const { st, said } = replay([{ fix: at(start, min(0)), time: min(0) }]);
    expect(st).toMatchObject({ leg: 0, phase: 'walk', missed: false });
    expect(st.toGo).toBeCloseTo(400, -1);
    expect(said).toEqual(['0:walk']);
  });

  it('counts down the walk along its line', () => {
    const { st } = replay([
      { fix: at(start, min(0)), time: min(0) },
      { fix: at(m(5, 150), min(2)), time: min(2) },
    ]);
    expect(st.toGo).toBeCloseTo(250, -1);
  });

  it('announces boarding two minutes ahead, then waits at the stop', () => {
    const { st, said } = replay([
      { fix: at(start, min(0)), time: min(0) },
      { fix: at(m(0, 300), min(6.5)), time: min(6.5) },
      { fix: at(s1, min(7)), time: min(7) },
    ]);
    expect(said).toEqual(['0:walk', '1:board']);
    expect(st).toMatchObject({ leg: 1, phase: 'wait', stopsLeft: 3 });
  });

  it('counts stops by position above ground', () => {
    const { st } = replay([
      { fix: at(s1, min(7)), time: min(7) },
      { fix: at(m(1500, 405), min(13)), time: min(13) },
    ]);
    expect(st).toMatchObject({ leg: 1, phase: 'ride', stopsLeft: 2 });
  });

  it('counts stops by the timetable underground, and says when to get off', () => {
    const { st, said } = replay([
      { fix: at(s1, min(7)), time: min(7) },
      // No fixes from here on: the last one goes stale.
      { fix: null, time: min(10) },
      { fix: null, time: min(13) },
      { fix: null, time: min(17) },
    ]);
    expect(st).toMatchObject({ leg: 1, phase: 'ride', stopsLeft: 1 });
    expect(said).toEqual(['1:board', '1:next']);
  });

  it('walks the last bit and arrives', () => {
    const { st, said } = replay([
      { fix: at(s1, min(7)), time: min(7) },
      { fix: at(s2, min(20)), time: min(20) },
      { fix: at(m(3000, 200), min(22)), time: min(22) },
      { fix: at(end, min(24)), time: min(24) },
    ]);
    expect(st.phase).toBe('arrived');
    expect(said).toContain('2:walk');
    expect(said.at(-1)).toBe('3:arrived');
  });

  it('notices a missed departure and stops promising it', () => {
    const { st, said } = replay([
      { fix: at(start, min(0)), time: min(0) },
      { fix: at(m(0, 50), min(8.6)), time: min(8.6) },
    ]);
    expect(st).toMatchObject({ leg: 0, phase: 'walk', missed: true });
    // Said once, and no boarding promised for a vehicle that has gone.
    expect(said).toEqual(['0:walk', '1:missed']);
  });

  it('shows the next real turn of a walk, with the metres to it', () => {
    const { st } = replay([{ fix: at(m(0, 100), min(1)), time: min(1) }]);
    expect(st.turn).toMatchObject({ turn: 'right', street: 'Bahnhofsvorplatz' });
    expect(st.turn!.in).toBeCloseTo(250, -1);
    const lost = replay([{ fix: at(m(500, 100), min(1)), time: min(1) }]).st;
    expect(lost.turn).toBeNull();
  });

  it('stays on board a late train while the position says so', () => {
    // Planned to arrive at 20; at 23 the rider is still 1.4 km short, on the line.
    const { st, said } = replay([
      { fix: at(s1, min(7)), time: min(7) },
      { fix: at(m(1000, 402), min(15)), time: min(15) },
      { fix: at(m(1600, 402), min(23)), time: min(23) },
      { fix: at(m(2400, 402), min(26)), time: min(26) },
    ]);
    expect(st).toMatchObject({ leg: 1, phase: 'ride', stopsLeft: 1 });
    expect(said).toEqual(['1:board', '1:next']);
    expect(said).not.toContain('2:walk');
  });

  it('offers a new connection to a rider left standing at the stop', () => {
    // At the stop in time (7), the U6 due at 8; at 12 the rider is still there.
    const left = replay([
      { fix: at(s1, min(7)), time: min(7) },
      { fix: at(s1, min(9)), time: min(9) },
      { fix: at(s1, min(12)), time: min(12) },
    ]);
    expect(left.st).toMatchObject({ leg: 1, phase: 'wait', missed: true });
    expect(left.said).toEqual(['1:board', '1:missed']);
    // Within the first minutes it may just be late: still the ride as planned.
    const late = replay([
      { fix: at(s1, min(7)), time: min(7) },
      { fix: at(s1, min(10)), time: min(10) },
    ]);
    expect(late.st).toMatchObject({ leg: 1, phase: 'ride', missed: false });
    // The late train comes after all: along the line, riding again.
    const after = replay([
      { fix: at(s1, min(7)), time: min(7) },
      { fix: at(s1, min(12)), time: min(12) },
      { fix: at(m(400, 402), min(14)), time: min(14) },
    ]);
    expect(after.st).toMatchObject({ leg: 1, phase: 'ride', missed: false });
  });

  it('counts a departure as missed when the stop is reached after it', () => {
    const { st } = replay([
      { fix: at(start, min(0)), time: min(0) },
      { fix: at(m(0, 250), min(7.9)), time: min(7.9) },
      // The U6 left at 8; the rider gets to the platform at 10.
      { fix: at(s1, min(10)), time: min(10) },
    ]);
    expect(st).toMatchObject({ leg: 0, phase: 'walk', missed: true });
  });

  it('counts a departure as missed when the rider is still near the stop', () => {
    const { st } = replay([
      { fix: at(start, min(0)), time: min(0) },
      { fix: at(m(0, 250), min(8.6)), time: min(8.6) },
    ]);
    expect(st).toMatchObject({ leg: 0, missed: true });
    expect(st.phase).toBe('walk');
  });

  it('rides a late vehicle once the position moves along its line', () => {
    const { st } = replay([
      { fix: at(start, min(0)), time: min(0) },
      { fix: at(m(0, 395), min(9)), time: min(9) },
      { fix: at(m(400, 401), min(11)), time: min(11) },
    ]);
    expect(st).toMatchObject({ leg: 1, phase: 'ride', missed: false });
  });

  it('does not send the rider to a cancelled trip', () => {
    const cancelled: Transit = {
      ...transit,
      legs: transit.legs.map((l) => (l.ride ? { ...l, cancelled: true } : l)),
    };
    let st = initialRide(cancelled, min(6.5), at(m(0, 300), min(6.5)));
    expect(st).toMatchObject({ phase: 'walk', cancelled: true });
    // Said once that it does not run; never "board".
    const p = ridePrompt(cancelled, markRideSpoken(st, '0:walk'));
    expect(p).toMatchObject({ kind: 'cancelled', leg: 1 });
    st = markRideSpoken(markRideSpoken(st, '0:walk'), p!.key);
    expect(ridePrompt(cancelled, st)).toBeNull();
    st = rideStep(cancelled, st, at(s1, min(9)), min(9));
    expect(st).toMatchObject({ phase: 'wait', cancelled: true });
    expect(ridePrompt(cancelled, st)).toBeNull();
  });
});

describe('getting off and arriving', () => {
  // A tram with stops 280 m apart; due at the last but one a minute before the end.
  const a = m(0, 0);
  const b = m(280, 0);
  const c = m(560, 0);
  const d = m(840, 0);
  const tram: Transit = parseMotis({
    itineraries: [
      {
        startTime: iso(0),
        endTime: iso(10),
        legs: [
          leg('TRAM', a, d, 0, 6, {
            displayName: 'M1',
            legGeometry: { points: encodePolyline([a, b, c, d]), precision: 6 },
            intermediateStops: [
              place(b, 'B', { arrival: iso(3) }),
              place(c, 'C', { arrival: iso(5) }),
            ],
          }),
          leg('WALK', d, m(840, -200), 6, 10, { distance: 200 }),
        ],
      },
    ],
  })[0].transit!;

  it('does not end the ride at the stop before, however close and late', () => {
    let st = initialRide(tram, min(1), at(m(100, 2), min(1)));
    st = rideStep(tram, st, at(m(560, 3), min(5.2)), min(5.2));
    expect(st).toMatchObject({ leg: 0, phase: 'ride', stopsLeft: 1 });
    st = rideStep(tram, st, at(m(838, 2), min(6)), min(6));
    expect(st).toMatchObject({ leg: 1, phase: 'walk' });
  });

  it('gets off at the stop whenever the vehicle is early', () => {
    let st = initialRide(tram, min(1), at(m(100, 2), min(1)));
    st = rideStep(tram, st, at(m(842, 1), min(3.5)), min(3.5));
    expect(st.phase).toBe('walk');
  });

  it('never says "arrived" on the timetable alone', () => {
    let st = initialRide(tram, min(1), at(m(100, 2), min(1)));
    // Underground from here on: no fix at all for an hour.
    for (const t of [10, 20, 40, 60]) st = rideStep(tram, st, null, min(t));
    expect(st.phase).not.toBe('arrived');
    st = rideStep(tram, st, at(m(840, -195), min(61)), min(61));
    expect(st.phase).toBe('arrived');
  });

  it('arrives at a destination by the stop only on a position there', () => {
    // The connection ends on board: no walk after it.
    const onBoard: Transit = { ...transit, legs: transit.legs.slice(0, 2) };
    let st = initialRide(onBoard, min(7), at(s1, min(7)));
    st = rideStep(onBoard, st, at(m(500, 400), min(10)), min(10));
    for (const t of [21, 30, 60]) st = rideStep(onBoard, st, null, min(t));
    expect(st.phase).not.toBe('arrived');
    // Far off the line, the timetable long past: still not there.
    st = rideStep(onBoard, st, at(m(1500, 1400), min(61)), min(61));
    expect(st.phase).not.toBe('arrived');
    st = rideStep(onBoard, st, at(s2, min(62)), min(62));
    expect(st.phase).toBe('arrived');
  });

  it('says "next stop" for a ride of one stop only once it moves', () => {
    const one: Transit = {
      ...transit,
      legs: transit.legs.map((l) => (l.ride ? { ...l, via: [] } : l)),
    };
    let st = initialRide(one, min(7.5), at(s1, min(7.5)));
    const said: string[] = [];
    const go = (fix: Fix, time: number) => {
      st = rideStep(one, st, fix, time);
      const p = ridePrompt(one, st);
      if (p) {
        said.push(p.key);
        st = markRideSpoken(st, p.key);
      }
    };
    // Departed by the timetable, the vehicle late: still on the platform.
    go(at(s1, min(8.5)), min(8.5));
    go(at(s1, min(9)), min(9));
    expect(said).not.toContain('1:next');
    go(at(m(800, 400), min(11)), min(11));
    expect(said).toContain('1:next');
  });

  it('arrives when the rider got there another way, the ride missed', () => {
    let st = initialRide(transit, min(6), at(m(0, 300), min(6)));
    st = rideStep(transit, st, at(m(0, 320), min(9)), min(9));
    expect(st.missed).toBe(true);
    st = rideStep(transit, st, at(end, min(40)), min(40));
    expect(st.phase).toBe('arrived');
  });

  it('counts only the stops the vehicle still calls at', () => {
    const skipping: Transit = {
      ...tram,
      legs: tram.legs.map((l) =>
        l.ride
          ? { ...l, via: l.via.map((v) => (v.name === 'B' ? { ...v, skipped: true } : v)) }
          : l,
      ),
    };
    const st = initialRide(skipping, min(1), at(m(20, 2), min(1)));
    expect(st.stopsLeft).toBe(2);
  });
});

describe('a gap in GPS at the departure', () => {
  it('turns a ride entered on the timetable into a missed departure once a fix says so', () => {
    const { st, said } = replay([
      { fix: at(m(0, 300), min(6)), time: min(6) },
      // In the station hall: no fix while the U6 leaves at 8.
      { fix: null, time: min(8.2) },
      { fix: null, time: min(9) },
      // Back above ground, still by the stop.
      { fix: at(m(30, 380), min(9.5)), time: min(9.5) },
    ]);
    expect(st).toMatchObject({ leg: 0, phase: 'walk', missed: true });
    expect(said).toContain('1:missed');
  });

  it('turns it into a missed departure even once the timetable has carried the rider past it', () => {
    const { st, said } = replay([
      { fix: at(m(0, 300), min(6)), time: min(6) },
      // No fix through the whole ride's time, then one still by the stop boarded at.
      { fix: null, time: min(8.2) },
      { fix: null, time: min(23) },
      { fix: at(m(30, 380), min(23.5)), time: min(23.5) },
    ]);
    expect(st).toMatchObject({ leg: 0, phase: 'walk', missed: true });
    expect(said).toContain('1:missed');
  });

  it('keeps the ride when the fix is along the line', () => {
    const { st } = replay([
      { fix: at(m(0, 300), min(6)), time: min(6) },
      { fix: null, time: min(8.2) },
      { fix: at(m(600, 401), min(10)), time: min(10) },
    ]);
    expect(st).toMatchObject({ leg: 1, phase: 'ride' });
  });
});

describe('walking', () => {
  it('counts straight to the stop off the line, and keeps the count without a fix', () => {
    let st = initialRide(transit, min(1), at(m(300, 100), min(1)));
    expect(st.toGo).toBeCloseTo(Math.hypot(300, 300), -1);
    st = rideStep(transit, st, null, min(1.5) + FRESH_MS);
    expect(st.toGo).toBeCloseTo(Math.hypot(300, 300), -1);
  });

  it('counts a stop as reached within the accuracy of a poor fix', () => {
    const st = initialRide(transit, min(7), { ...at(m(60, 400), min(7)), accuracy: 80 });
    expect(st.phase).toBe('wait');
  });
});

describe('what changed', () => {
  it('says a new platform and a delay once each', () => {
    const live: Transit = {
      ...transit,
      legs: transit.legs.map((l) =>
        l.ride ? { ...l, delay: 4, from: { ...l.from, track: '3', scheduledTrack: '1' } } : l,
      ),
    };
    let st = initialRide(live, min(1), at(m(0, 100), min(1)));
    const said: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = ridePrompt(live, st);
      if (!p) break;
      said.push(p.kind);
      st = markRideSpoken(st, p.key);
    }
    expect(said).toEqual(['walk', 'platform', 'delay']);
  });
});
