import { describe, expect, it } from 'vitest';
import { ALONG, ON_THE_WAY_M, placesAlong, tilesAlong } from '../src/core/alongRoute';
import { track } from '../src/core/nav';
import type { Route } from '../src/core/route';

const O = { lng: 13.4, lat: 52.5 };
/** A point `east`/`north` metres from O. */
const m = (east: number, north: number): [number, number] => [
  O.lng + east / (111_195 * Math.cos((O.lat * Math.PI) / 180)),
  O.lat + north / 111_195,
];
const at = (name: string, east: number, north: number) => {
  const [lng, lat] = m(east, north);
  return { name, lng, lat };
};
// 20 km straight north.
const route: Route = {
  coords: [m(0, 0), m(0, 10_000), m(0, 20_000)],
  distance: 20_000,
  duration: 1200,
  bbox: [0, 0, 0, 0],
  maneuvers: [],
};
const tr = track(route);

describe('along the route', () => {
  it('reads the tiles under the band ahead, in the order the way reaches them', () => {
    const tiles = tilesAlong(tr, 0, 'car');
    expect(tiles.length).toBeGreaterThan(10);
    expect(tiles.length).toBeLessThanOrEqual(60);
    // Northward: the rows (y) go north as the way does; the first ones reach just behind.
    const ys = tiles.map((t) => t.y);
    expect(Math.max(...ys)).toBeLessThanOrEqual(ys[0] + 1);
    expect(ys.at(-1)!).toBeLessThan(ys[0] - 5);
    expect(new Set(tiles.map((t) => `${t.x}/${t.y}`)).size).toBe(tiles.length);
    // On foot, only the next 3 km: a few tiles.
    expect(tilesAlong(tr, 0, 'foot').length).toBeLessThan(10);
    // From further on, not the ones behind.
    const later = tilesAlong(tr, 15_000, 'car');
    expect(later[0].y).toBeLessThan(tiles[0].y);
  });

  it('lists places in the band ahead, nearest along the way first, with the detour', () => {
    const places = [
      at('Far side', 600, 5_000), // outside the car band
      at('Behind', 50, 1_000),
      at('Next', 200, 4_000),
      at('First', 10, 3_000),
      at('First', 10, 3_000), // the same, from an overlapping tile
      at('Beyond reach', 0, 19_999),
    ];
    const hits = placesAlong(tr, places, 2_000, 'car');
    expect(hits.map((h) => h.it.name)).toEqual(['First', 'Next', 'Beyond reach']);
    expect(hits[0].ahead).toBeCloseTo(1_000, -1);
    // On the way: no detour; 200 m off: there and back.
    expect(hits[0].off).toBeLessThan(ON_THE_WAY_M);
    expect(hits[0].detour).toBe(0);
    expect(hits[1].detour).toBeCloseTo(50, -1);
    // On foot the band is narrow and the reach short.
    expect(placesAlong(tr, places, 2_000, 'foot').map((h) => h.it.name)).toEqual(['First']);
    expect(ALONG.foot.band).toBeLessThan(ALONG.car.band);
  });
});
