import { describe, expect, it } from 'vitest';
import { snap, track } from '../src/core/nav';
import { narrateWays } from '../src/core/roundabout';
import type { Maneuver, Route } from '../src/core/route';
import { TOWN_NEAR_M, townAhead, townsOnWay, type Town } from '../src/core/towns';

// Metres east (x) and north (y) of a point in the Midlands, as [lng, lat].
const m = (x: number, y: number): [number, number] => [-7.5 + x / 66500, 53.27 + y / 111200];
const at = (name: string, kind: Town['kind'], x: number, y: number): Town => {
  const [lng, lat] = m(x, y);
  return { name, kind, lng, lat };
};
const words = { toward: (p: string) => `towards ${p}`, heading: (w: string) => `heading ${w}` };
const man = (o: Partial<Maneuver>): Maneuver => ({
  type: 8,
  instruction: '',
  distance: 0,
  duration: 0,
  begin: 0,
  ...o,
});
// North 1 km to a roundabout, out east for 30 km.
const coords = [m(0, -1000), m(0, -20), m(15, 0), m(30, 0), m(30_000, 0)];
const route = (exitTo?: string): Route => ({
  coords,
  distance: 31_000,
  duration: 1500,
  bbox: [0, 0, 0, 0],
  maneuvers: [
    man({ type: 1, instruction: 'Head north.', distance: 1000 }),
    man({
      type: 26,
      begin: 1,
      instruction: 'Enter the roundabout and take the 2nd exit.',
      pre: 'Enter the roundabout and take the 2nd exit.',
      ...(exitTo ? { toward: exitTo } : {}),
    }),
    man({ type: 27, begin: 3, instruction: 'Exit the roundabout.', distance: 30_000 }),
    man({ type: 4, begin: 4, instruction: 'You have arrived.' }),
  ],
});
const towns = [
  at('Here', 'town', 200, 300), // the town the roundabout is in
  at('Offside', 'city', 5_000, 9_000), // far off the road
  at('Rahan', 'village', 6_000, 500),
  at('Tullamore', 'town', 12_000, 800),
  at('Dublin', 'city', 25_000, -400),
];

describe('towns ahead', () => {
  it('names the next town on the way, not the one here nor one off the road', () => {
    const tr = track(route());
    expect(townAhead(tr, tr.along[3], towns)).toBe('Tullamore');
    // Past it: the next.
    expect(townAhead(tr, tr.along[3] + 14_000, towns)).toBe('Dublin');
    // Only villages near: the nearest of them; none at all: nothing.
    expect(townAhead(tr, tr.along[3], [towns[2]])).toBe('Rahan');
    expect(townAhead(tr, tr.along[3], [at('Far village', 'village', 20_000, 0)])).toBeNull();
  });

  it('says a roundabout leads towards the next town without a sign, the compass last', () => {
    const r = narrateWays(route(), words, towns);
    expect(r.maneuvers[1].wayOut).toBe('towards Tullamore');
    expect(r.maneuvers[1].pre).toBe(
      'Enter the roundabout and take the 2nd exit, towards Tullamore.',
    );
    // A sign wins; without towns, where the exit road leads.
    expect(narrateWays(route('Birr'), words, towns).maneuvers[1].wayOut).toBe('towards Birr');
    expect(narrateWays(route(), words).maneuvers[1].wayOut).toBe('heading e');
  });

  it('names towns at junctions and turns onto long roads, not at every street corner', () => {
    const r = (type: number, distance: number): Route => ({
      ...route(),
      maneuvers: [
        man({ type: 1, instruction: 'Head north.' }),
        man({ type, begin: 3, instruction: 'Turn right.', distance }),
        man({ type: 4, begin: 4, instruction: 'You have arrived.' }),
      ],
    });
    expect(narrateWays(r(10, 30_000), words, towns).maneuvers[1].wayOut).toBe('towards Tullamore');
    expect(narrateWays(r(20, 500), words, towns).maneuvers[1].wayOut).toBe('towards Tullamore');
    expect(narrateWays(r(10, 300), words, towns).maneuvers[1].wayOut).toBeUndefined();
  });
});

describe('towns along a long drive', () => {
  // 150 km of winding road in 6000 points, 200 junctions, 400 towns and villages around it.
  const coords = Array.from({ length: 6000 }, (_, i) => m(i * 25, Math.sin(i / 50) * 300));
  const long: Route = {
    coords,
    distance: 150_000,
    duration: 6000,
    bbox: [0, 0, 0, 0],
    maneuvers: Array.from({ length: 200 }, (_, i) =>
      man({ type: 20, instruction: 'Take the exit.', distance: 750, begin: i * 30 }),
    ),
  };
  const many = Array.from({ length: 400 }, (_, i) =>
    at(`T${i}`, i % 5 ? 'village' : 'town', (i * 397) % 150_000, ((i * 7919) % 8000) - 4000),
  );

  it('finds the same towns on the way as snapping each onto the whole road', () => {
    const tr = track(long);
    const slow = many
      .map((town) => ({ town, s: snap(tr, town) }))
      .filter(({ s }) => s.offset <= TOWN_NEAR_M)
      .sort((a, b) => a.s.along - b.s.along)
      .map(({ town }) => town.name);
    expect(townsOnWay(tr, many).map(({ town }) => town.name)).toEqual(slow);
  });

  it('names every junction without freezing the app (a minute before)', () => {
    const t0 = performance.now();
    const named = narrateWays(long, words, many);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(named.maneuvers.filter((x) => x.wayOut).length).toBeGreaterThan(100);
  });
});
