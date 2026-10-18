import { describe, expect, it } from 'vitest';
import { initialNav, markSpoken, prompt, step, track, type Fix } from '../src/core/nav';
import { encodePolyline, parseValhalla, routeUrl } from '../src/core/route';
import { MAX_STOPS, nameStops, stopsReached, type StopWords } from '../src/core/stops';

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
});
