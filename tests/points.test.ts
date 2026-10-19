import { describe, expect, it } from 'vitest';
import { addPoint, endsOf, MAX_POINTS, movePoint, pointsOf, removePoint } from '../src/core/points';

const place = (name: string, lng = 13) => ({ name, detail: '', lng, lat: 52 });
const [a, b, c] = [place('A', 13.1), place('B', 13.2), place('C', 13.3)];
const here = { ...place('My location', 13.4), here: true as const };

describe('route points', () => {
  it('are the trip start to end, my location as null', () => {
    expect(pointsOf({ from: null, via: [a], to: b })).toEqual([null, a, b]);
    expect(endsOf([null, a, b], here)).toEqual({ from: null, via: [a], to: b });
  });

  it('move to any place, the rest keeping their order', () => {
    expect(movePoint(['s', 'x', 'y', 'e'], 3, 0)).toEqual(['e', 's', 'x', 'y']);
    expect(movePoint(['s', 'x', 'y', 'e'], 0, 3)).toEqual(['x', 'y', 'e', 's']);
    expect(movePoint(['s', 'e'], 1, 1)).toEqual(['s', 'e']);
  });

  it('take my location anywhere but first as the position now, and back again live', () => {
    // Dragged to the end: the destination is where the user is now, as a swap did.
    expect(endsOf(movePoint([null, a], 0, 1), here)).toEqual({ from: a, via: [], to: here });
    expect(endsOf([a, null, b], here)).toEqual({ from: a, via: [here], to: b });
    // Without a position there is no such trip.
    expect(endsOf([a, null], null)).toBeNull();
    // Back at the start it is the live position.
    expect(endsOf([here, a], here)).toEqual({ from: null, via: [], to: a });
  });

  it('keep two at least, and at most a start, three stops and an end', () => {
    expect(removePoint([a, b], 0)).toEqual([a, b]);
    expect(removePoint([a, b, c], 0)).toEqual([b, c]);
    expect(addPoint([a, b], c)).toEqual([a, c, b]);
    const full = [a, b, c, a, b];
    expect(MAX_POINTS).toBe(5);
    expect(addPoint(full, c)).toEqual(full);
  });
});
