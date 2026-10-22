import { describe, expect, it } from 'vitest';
import { tilePoint, tilesIn, tileUrl } from '../src/core/tiles';

describe('tilesIn', () => {
  const berlin = { lng: 13.3889, lat: 52.517 };

  it('finds the zoom-14 tile under a point', () => {
    const b = { west: berlin.lng, east: berlin.lng, south: berlin.lat, north: berlin.lat };
    expect(tilesIn(b, berlin)).toEqual([{ z: 14, x: 8801, y: 5373 }]);
  });

  it('covers a view, nearest the centre first', () => {
    const b = { west: 13.35, east: 13.43, south: 52.5, north: 52.53 };
    const t = tilesIn(b, berlin);
    expect(t.length).toBe(5 * 3);
    expect(t[0]).toEqual({ z: 14, x: 8801, y: 5373 });
  });

  it('reads only the middle of a wide view', () => {
    const b = { west: 12.9, east: 13.9, south: 52.3, north: 52.7 };
    const t = tilesIn(b, berlin, 14, 48);
    expect(t.length).toBe(48);
    expect(t.every(({ x, y }) => Math.abs(x - 8801) <= 4 && Math.abs(y - 5373) <= 4)).toBe(true);
  });

  it('looks only around the centre of a continent-wide view, at once', () => {
    const europe = { west: -25, east: 45, south: 34, north: 71 };
    const t0 = performance.now();
    const t = tilesIn(europe, berlin);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(t.length).toBe(48);
    expect(t[0]).toEqual({ z: 14, x: 8801, y: 5373 });
    // The whole globe, as a view with a pole in it reports.
    const world = tilesIn({ west: -180, east: 180, south: -85, north: 85 }, berlin);
    expect(world.length).toBe(48);
  });

  it('finds the tiles with the middle just east of the antimeridian, wrapped or not', () => {
    const taveuni = { lng: -179.995, lat: -17.8 };
    for (const east of [-179.98, 180.02]) {
      const t = tilesIn({ west: 179.99, east, south: -17.81, north: -17.79 }, taveuni);
      expect(t.length).toBeGreaterThan(0);
      expect(t[0].x).toBe(0);
      expect(new Set(t.map((x) => x.x))).toEqual(new Set([0, 2 ** 14 - 1]));
    }
  });

  it('wraps around the antimeridian', () => {
    const fiji = { lng: 179.999, lat: -17.8 };
    const t = tilesIn({ west: 179.99, east: -179.99, south: -17.81, north: -17.79 }, fiji);
    const xs = new Set(t.map((tile) => tile.x));
    expect(xs.has(0)).toBe(true);
    expect(xs.has(2 ** 14 - 1)).toBe(true);
  });

  it('fills a URL template', () => {
    expect(tileUrl('https://t.example/a/{z}/{x}/{y}.pbf', { z: 14, x: 1, y: 2 })).toBe(
      'https://t.example/a/14/1/2.pbf',
    );
  });
});

describe('tilePoint', () => {
  it('turns tile pixels back into the point they came from', () => {
    const p = { lng: 13.3889, lat: 52.517 };
    const [t] = tilesIn({ west: p.lng, east: p.lng, south: p.lat, north: p.lat }, p);
    const n = 2 ** 14;
    const px = (((p.lng + 180) / 360) * n - t.x) * 4096;
    const r = (p.lat * Math.PI) / 180;
    const py = (((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n - t.y) * 4096;
    const q = tilePoint(t, px, py, 4096);
    expect(q.lng).toBeCloseTo(p.lng, 6);
    expect(q.lat).toBeCloseTo(p.lat, 6);
  });

  it('puts a tile corner on its edge', () => {
    expect(tilePoint({ z: 0, x: 0, y: 0 }, 0, 0, 4096).lng).toBe(-180);
    expect(tilePoint({ z: 1, x: 1, y: 1 }, 0, 0, 4096)).toEqual({ lng: 0, lat: 0 });
  });
});
