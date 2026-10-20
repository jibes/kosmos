import { describe, expect, it } from 'vitest';
import { track } from '../src/core/nav';
import {
  WORLD_EVERY_MS,
  tileKey,
  toEvict,
  tripTiles,
  worldDue,
  worldTiles,
} from '../src/core/offline';
import type { Route } from '../src/core/route';

const O = { lng: 13.4, lat: 52.5 };
const m = (east: number, north: number): [number, number] => [
  O.lng + east / (111_195 * Math.cos((O.lat * Math.PI) / 180)),
  O.lat + north / 111_195,
];

describe('offline map', () => {
  it('keeps tiles without the planet build in their URL', () => {
    expect(
      tileKey('https://tiles.openfreemap.org/planet/20261001_001001_pt/14/8800/5373.pbf'),
    ).toBe('https://tiles.openfreemap.org/planet/any/14/8800/5373.pbf');
  });

  it('knows the whole world down to zoom 5, coarsest first', () => {
    const w = worldTiles();
    expect(w).toHaveLength(1 + 4 + 16 + 64 + 256 + 1024);
    expect(w[0]).toEqual({ z: 0, x: 0, y: 0 });
    expect(w.at(-1)!.z).toBe(5);
  });

  it('keeps a trip in full detail along the road, coarser around it, fewest first', () => {
    const route: Route = {
      coords: [m(0, 0), m(0, 30_000)],
      distance: 30_000,
      duration: 1800,
      bbox: [0, 0, 0, 0],
      maneuvers: [],
    };
    const tiles = tripTiles(track(route));
    const zs = tiles.map((t) => t.z);
    expect(zs[0]).toBe(8);
    expect(zs.at(-1)).toBe(14);
    // 30 km at zoom 14 (about 1.5 km a tile here): some tens, not hundreds.
    const detail = tiles.filter((t) => t.z === 14).length;
    expect(detail).toBeGreaterThan(15);
    expect(detail).toBeLessThan(80);
  });

  it('lets go of the tiles shown longest ago, never the world', () => {
    const e = [
      { k: 'world', at: 0, size: 50, keep: true },
      { k: 'old', at: 1, size: 40 },
      { k: 'mid', at: 2, size: 40 },
      { k: 'new', at: 3, size: 40 },
    ];
    expect(toEvict(e, 200)).toEqual([]);
    expect(toEvict(e, 100)).toEqual(['old', 'mid']);
    expect(toEvict(e, 10)).toEqual(['old', 'mid', 'new']);
  });

  it('fetches the world again each month, or when it holds less zoom', () => {
    expect(worldDue(null, 0)).toBe(true);
    expect(worldDue({ at: 0, z: 5 }, WORLD_EVERY_MS - 1)).toBe(false);
    expect(worldDue({ at: 0, z: 5 }, WORLD_EVERY_MS)).toBe(true);
    expect(worldDue({ at: 0, z: 4 }, 1)).toBe(true);
  });
});
