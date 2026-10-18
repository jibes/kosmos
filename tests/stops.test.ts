import { describe, expect, it } from 'vitest';
import { initialNav, markSpoken, prompt, step, track, type Fix } from '../src/core/nav';
import { encodePolyline, parseValhalla, routeUrl } from '../src/core/route';
import {
  leavingStop,
  MAX_STOPS,
  moveStopUp,
  nameStops,
  SKIP_AWAY_M,
  stopsReached,
  type StopWords,
} from '../src/core/stops';

const O = { lng: 13.4, lat: 52.5 };
/** A point `east`/`north` metres from O. */
const m = (east: number, north: number): [number, number] => [
  O.lng + east / (111_195 * Math.cos((O.lat * Math.PI) / 180)),
  O.lat + north / 111_195,
];

/** A leg straight north from `a` to `b` metres, as the router gives one: off, then there. */
const leg = (a: number, b: number) => ({
  shape: encodePolyline([m(0, a), m(0, b)]),
  maneuvers: [
    { type: 1, instruction: 'Head north.', verbal_pre_transition_instruction: 'Head north.' },
    {
      type: 4,
      instruction: 'You have arrived at your destination.',
      verbal_pre_transition_instruction: 'You have arrived at your destination.',
      verbal_transition_alert_instruction: 'You will arrive at your destination.',
      begin_shape_index: 1,
    },
  ].map((x) => ({ length: (b - a) / 1000, time: (b - a) / 10, begin_shape_index: 0, ...x })),
});

const WORDS: StopWords = {
  instruction: (n) => `Stop at ${n}`,
  alert: (n) => `stop at ${n}`,
  pre: (n) => `Your stop: ${n}.`,
};

/** 0 → 500 m (Anna's), → 1000 m (Ben's), → 1500 m, the destination. */
const route = nameStops(
  parseValhalla({
    trip: { legs: [leg(0, 500), leg(500, 1000), leg(1000, 1500)], summary: { length: 1.5 } },
  })[0],
  ['Anna', 'Ben'],
  0,
  WORDS,
);

const fixAt = (north: number, time: number): Fix => ({
  lng: m(0, north)[0],
  lat: m(0, north)[1],
  accuracy: 8,
  speed: 10,
  time,
});

describe('stops on the way', () => {
  it('asks the router by way of each stop, with no other ways', () => {
    const url = routeUrl(O, { lng: 13.5, lat: 52.6 }, 'car', 'en', 2, 'metric', false, [
      { lng: 13.45, lat: 52.55 },
    ]);
    const body = JSON.parse(new URL(url).searchParams.get('json')!);
    expect(body.locations).toEqual([
      { lat: 52.5, lon: 13.4 },
      { lat: 52.55, lon: 13.45 },
      { lat: 52.6, lon: 13.5 },
    ]);
    expect(body.alternates).toBe(0);
    expect(MAX_STOPS).toBe(3);
  });

  it('marks where each leg but the last ends, and says it by the stop’s name', () => {
    const stops = route.maneuvers.filter((x) => x.via !== undefined);
    expect(stops.map((x) => [x.via, x.instruction, x.alert, x.pre])).toEqual([
      [0, 'Stop at Anna', 'stop at Anna', 'Your stop: Anna.'],
      [1, 'Stop at Ben', 'stop at Ben', 'Your stop: Ben.'],
    ]);
    expect(route.maneuvers.at(-1)!.instruction).toBe('You have arrived at your destination.');
    // A reroute after Anna's names Ben's as the trip's second stop.
    const later = nameStops(
      parseValhalla({ trip: { legs: [leg(600, 1000), leg(1000, 1500)] } })[0],
      ['Anna', 'Ben'],
      1,
      WORDS,
    );
    expect(later.maneuvers.find((x) => x.via !== undefined)).toMatchObject({
      via: 1,
      pre: 'Your stop: Ben.',
    });
  });

  it('says each stop on the way, arrives only at the end', () => {
    const tr = track(route);
    let st = markSpoken(initialNav(), '0:pre');
    const said: string[] = [];
    let behind = 0;
    for (let n = 0, i = 0; n <= 1500; n += 10, i++) {
      st = step(tr, st, fixAt(n, i * 1000));
      const p = prompt(tr, st, 'car');
      if (p) {
        said.push(p.text);
        st = markSpoken(st, p.key);
      }
      behind = stopsReached(tr, st, behind);
      if (n === 480) expect(behind).toBe(1); // at Anna's, not yet past it
      if (n === 700) expect(behind).toBe(1);
    }
    expect(said.filter((x) => x.startsWith('Your stop'))).toEqual([
      'Your stop: Anna.',
      'Your stop: Ben.',
    ]);
    expect(said.filter((x) => x.includes('arrived'))).toEqual([
      'You have arrived at your destination.',
    ]);
    expect(st.arrived).toBe(true);
    expect(behind).toBe(2);
  });

  it('counts no stop reached off the route, nor one never got to', () => {
    const tr = track(route);
    const st = step(tr, initialNav(), fixAt(200, 0));
    expect(stopsReached(tr, st, 0)).toBe(0);
    expect(stopsReached(tr, { ...st, offRoute: true, next: 1 }, 0)).toBe(0);
    // What was reached before a reroute stays reached.
    expect(stopsReached(tr, st, 1)).toBe(1);
  });

  it('moves a stop a place earlier, never before one already reached', () => {
    expect(moveStopUp(['a', 'b', 'c'], 2)).toEqual(['a', 'c', 'b']);
    expect(moveStopUp(['a', 'b', 'c'], 0)).toEqual(['a', 'b', 'c']);
    // Guiding, a reached: b stays the next one.
    expect(moveStopUp(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
    expect(moveStopUp(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
  });

  it('arrives 40 m short of the end along the route: the door is off the road', () => {
    const tr = track(route);
    let st = markSpoken(initialNav(), '0:pre');
    for (let n = 0, i = 0; n <= 1465; n += 5, i++) st = step(tr, st, fixAt(n, i * 500));
    expect(st.arrived).toBe(true);
    let short = markSpoken(initialNav(), '0:pre');
    for (let n = 0, i = 0; n <= 1450; n += 5, i++) short = step(tr, short, fixAt(n, i * 500));
    expect(short.arrived).toBe(false);
  });
});

describe('a stop left behind', () => {
  it('is asked about only off the route, well beyond the closest yet', () => {
    let w = leavingStop(null, 0, 3000, true, 'car').watch;
    // Getting closer, then away again: off the route and 1 km past the closest, left behind.
    w = leavingStop(w, 0, 800, true, 'car').watch;
    expect(leavingStop(w, 0, 1700, true, 'car').leaving).toBe(false);
    expect(leavingStop(w, 0, 1900, true, 'car').leaving).toBe(true);
    // On the route the way may wind away from the stop: never.
    expect(leavingStop(w, 0, 5000, false, 'car').leaving).toBe(false);
    // On foot it comes sooner; the next stop starts afresh.
    expect(leavingStop({ stop: 0, closest: 100 }, 0, 300, true, 'foot').leaving).toBe(true);
    expect(leavingStop({ stop: 0, closest: 100 }, 1, 300, true, 'foot').leaving).toBe(false);
    expect(SKIP_AWAY_M.bike).toBeLessThan(SKIP_AWAY_M.car);
  });
});
