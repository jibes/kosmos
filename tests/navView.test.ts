import { describe, expect, it } from 'vitest';
import { boundsOf, navPitch, navZoomFor, routeRest, tripRest } from '../src/core/navView';
import type { RideState } from '../src/core/ride';
import type { Transit, TransitLeg } from '../src/core/transit';

type Pt = [number, number];
const leg = (coords: Pt[], ride: boolean) => ({ coords, ride }) as unknown as TransitLeg;
const transit = {
  legs: [
    leg(
      [
        [0, 0],
        [0, 1],
      ],
      false,
    ),
    leg(
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [3, 1],
      ],
      true,
    ),
    leg(
      [
        [3, 1],
        [3, 0],
      ],
      false,
    ),
  ],
} as Transit;
const at = (leg: number) => ({ leg }) as RideState;

describe('navigation views', () => {
  it('looks from behind by car, flatter by bike, from above on foot', () => {
    expect(navPitch('car')).toBeGreaterThan(navPitch('bike'));
    expect(navPitch('bike')).toBeGreaterThan(navPitch('foot'));
    expect(navPitch('foot')).toBe(0);
    expect(navZoomFor('foot', 1)).toBeGreaterThan(navZoomFor('bike', 5));
    // By car the zoom follows the speed: farther ahead on a motorway.
    expect(navZoomFor('car', 35)).toBeLessThan(navZoomFor('car', 5));
  });

  it('zooms with speed as a line, never by a jump, and closer as a turn comes', () => {
    // Every km/h from 0 to 150: no step bigger than a hair.
    for (let kmh = 0; kmh < 150; kmh++) {
      const step = navZoomFor('car', (kmh + 1) / 3.6) - navZoomFor('car', kmh / 3.6);
      expect(step).toBeLessThanOrEqual(0);
      expect(step).toBeGreaterThan(-0.05);
    }
    expect(navZoomFor('bike', 7)).toBeLessThan(navZoomFor('bike', 2));
    // At 50 km/h a turn 12 s ahead (167 m) starts to pull in, by 0.8 at the turn itself.
    const v = 50 / 3.6;
    expect(navZoomFor('car', v, 400)).toBe(navZoomFor('car', v));
    expect(navZoomFor('car', v, 80)).toBeGreaterThan(navZoomFor('car', v));
    expect(navZoomFor('car', v, 0) - navZoomFor('car', v)).toBeCloseTo(0.8);
    // Slow, a turn still counts from 150 m; on foot the view stays as it is.
    expect(navZoomFor('car', 2, 100)).toBeGreaterThan(navZoomFor('car', 2));
    expect(navZoomFor('foot', 1, 10)).toBe(navZoomFor('foot', 1));
  });

  it('keeps what is left of a road route from the user on', () => {
    const coords: Pt[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ];
    expect(routeRest(coords, 1, [1.5, 0])).toEqual([
      [1.5, 0],
      [2, 0],
      [3, 0],
    ]);
  });

  it('on board, the rest of the line; for the whole trip, everything to the end', () => {
    const line = tripRest(transit, at(1), [1.1, 1], false);
    expect(line[0]).toEqual([1.1, 1]);
    expect(line.slice(1)).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    const all = tripRest(transit, at(1), [1.1, 1], true);
    expect(all.at(-1)).toEqual([3, 0]);
    // Arrived: nothing left but the user.
    expect(tripRest(transit, at(3), [3, 0], true)).toEqual([[3, 0]]);
  });

  it('bounds some points', () => {
    expect(
      boundsOf([
        [1, 5],
        [-2, 3],
        [4, -1],
      ]),
    ).toEqual([
      [-2, -1],
      [4, 5],
    ]);
    expect(boundsOf([])).toBeNull();
  });
});
