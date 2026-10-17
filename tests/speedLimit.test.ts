import { describe, expect, it } from 'vitest';
import {
  lengthOf,
  limitAt,
  limitIn,
  limitsBody,
  overLimit,
  parseLimits,
} from '../src/core/speedLimit';

describe('speed limits', () => {
  it('asks for the route itself, edge by edge, in kilometres', () => {
    const body = JSON.parse(
      limitsBody([
        [13.4, 52.5],
        [13.41, 52.5],
      ]),
    );
    expect(body.shape_match).toBe('walk_or_snap');
    expect(body.units).toBe('kilometers');
    expect(body.filters.attributes).toContain('edge.speed_limit');
    expect(typeof body.encoded_polyline).toBe('string');
  });

  it('reads stretches, merges equal ones and scales them to the route', () => {
    const limits = parseLimits(
      {
        edges: [
          { length: 0.2, speed_limit: 50 },
          { length: 0.3, speed_limit: 50 },
          { length: 0.5 },
          { length: 1, speed_limit: 'unlimited' },
        ],
      },
      // The route measures 1 % longer along its points than the router's edges.
      2020,
    )!;
    expect(limits.kmh).toEqual([50, null, Infinity]);
    expect(limits.ends.map(Math.round)).toEqual([505, 1010, 2020]);
    expect(limitAt(limits, 0)).toBe(50);
    expect(limitAt(limits, 600)).toBeNull();
    expect(limitAt(limits, 1500)).toBe(Infinity);
    // Past the end (arriving): the last stretch's.
    expect(limitAt(limits, 3000)).toBe(Infinity);
    expect(limitAt(null, 10)).toBeNull();
    expect(parseLimits({ edges: [] }, 100)).toBeNull();
    expect(parseLimits(null, 100)).toBeNull();
  });

  it('turns red only well over the limit', () => {
    const kmh = (v: number) => v / 3.6;
    expect(overLimit(kmh(52), 50)).toBe(false);
    expect(overLimit(kmh(54), 50)).toBe(true);
    // 5 % of a motorway's 130 is more than 3.
    expect(overLimit(kmh(136), 130)).toBe(false);
    expect(overLimit(kmh(137), 130)).toBe(true);
    expect(overLimit(kmh(250), Infinity)).toBe(false);
    expect(overLimit(kmh(90), null)).toBe(false);
  });

  it('shows the limit as signed, in mph where roads count in miles', () => {
    expect(limitIn(48.28, 'us')).toBe(30);
    expect(limitIn(112.65, 'uk')).toBe(70);
    expect(limitIn(50, 'metric')).toBe(50);
    expect(
      Math.round(
        lengthOf([
          [13.4, 52.5],
          [13.4, 52.501],
        ]),
      ),
    ).toBe(111);
  });
});
