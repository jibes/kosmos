import { describe, expect, it } from 'vitest';
import { laneSize, lanesNeeded, laneViews, parseLanes } from '../src/core/lanes';

describe('lanes', () => {
  it('parses Valhalla lanes and drops what is no guidance', () => {
    expect(
      parseLanes([
        { directions: 8, active: 8 },
        { directions: 10, valid: 8 },
      ]),
    ).toEqual([
      { directions: 8, active: 8 },
      { directions: 10, valid: 8 },
    ]);
    expect(parseLanes([{ directions: 2 }])).toBeUndefined();
    expect(parseLanes([{ directions: 2 }, { foo: 1 }])).toBeUndefined();
    expect(parseLanes(undefined)).toBeUndefined();
  });

  it('paints every arrow and lights the ones on the route', () => {
    // Left only (best), left + straight (works), straight, straight + right.
    const views = laneViews([
      { directions: 8, active: 8 },
      { directions: 10, valid: 8 },
      { directions: 2 },
      { directions: 66 },
    ]);
    expect(views.map((v) => v.use)).toEqual(['best', 'ok', 'no', 'no']);
    expect(views[1].arrows).toEqual([
      { arrow: 'left', on: true },
      { arrow: 'straight', on: false },
    ]);
    expect(views[3].arrows.map((a) => a.arrow)).toEqual(['straight', 'right']);
  });

  it('reads an unmarked lane as straight on', () => {
    expect(
      laneViews([{ directions: 0 }, { directions: 1, active: 2 }]).map((v) => v.arrows),
    ).toEqual([[{ arrow: 'straight', on: false }], [{ arrow: 'straight', on: true }]]);
  });

  it('shows lanes only when there is a choice', () => {
    expect(lanesNeeded([{ directions: 8, active: 8 }, { directions: 2 }])).toBe(true);
    // Every lane works: nothing to choose.
    expect(
      lanesNeeded([
        { directions: 2, active: 2 },
        { directions: 2, active: 2 },
      ]),
    ).toBe(false);
    // The router marked none: no guidance to give.
    expect(lanesNeeded([{ directions: 8 }, { directions: 2 }])).toBe(false);
    expect(lanesNeeded(undefined)).toBe(false);
  });

  it('grows from a hint to the main thing as the maneuver nears', () => {
    expect(laneSize(1500, 14, 'car')).toBe('none');
    expect(laneSize(500, 14, 'car')).toBe('small');
    expect(laneSize(120, 14, 'car')).toBe('big');
    // On a motorway both come earlier: 40 s and 12 s ahead at 130 km/h.
    expect(laneSize(1300, 36, 'car')).toBe('small');
    expect(laneSize(400, 36, 'car')).toBe('big');
    expect(laneSize(150, 5, 'bike')).toBe('small');
    expect(laneSize(50, 5, 'bike')).toBe('big');
    expect(laneSize(10, 1.4, 'foot')).toBe('none');
  });
});
