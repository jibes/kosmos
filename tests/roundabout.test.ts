import { describe, expect, it } from 'vitest';
import { compassOf, headingFrom, narrateRoundabouts } from '../src/core/roundabout';
import type { Maneuver, Route } from '../src/core/route';

// Metres east (x) and north (y) of a point near Tullamore, as [lng, lat].
const m = (x: number, y: number): [number, number] => [-7.5 + x / 66500, 53.27 + y / 111200];
const words = {
  toward: (p: string) => `towards ${p}`,
  heading: (w: string) => `heading ${w}`,
};
const man = (o: Partial<Maneuver>): Maneuver => ({
  type: 8,
  instruction: '',
  distance: 0,
  duration: 0,
  begin: 0,
  ...o,
});
// In from the south, round the roundabout, out to the east.
const coords = [m(0, -200), m(0, -20), m(15, 0), m(30, 0), m(300, 0)];
const route = (enter: Partial<Maneuver>, exit: Partial<Maneuver> = {}): Route => ({
  coords,
  distance: 500,
  duration: 60,
  bbox: [0, 0, 0, 0],
  maneuvers: [
    man({ type: 1, instruction: 'Head north.' }),
    man({
      type: 26,
      begin: 1,
      instruction: 'Enter the roundabout and take the 2nd exit onto N52.',
      pre: 'Enter the roundabout and take the 2nd exit onto N52.',
      alert: 'Enter the roundabout.',
      ...enter,
    }),
    man({ type: 27, begin: 3, instruction: 'Exit the roundabout onto N52.', ...exit }),
    man({ type: 4, begin: 4, instruction: 'You have arrived.' }),
  ],
});

describe('roundabouts', () => {
  it('reads the compass from a bearing', () => {
    expect(compassOf(0)).toBe('n');
    expect(compassOf(91)).toBe('e');
    expect(compassOf(-45)).toBe('nw');
    expect(compassOf(359)).toBe('n');
    expect(headingFrom(coords, 3)).toBeCloseTo(90, 0);
    expect(headingFrom(coords, 4)).toBeNull();
  });

  it('says where the signs point, from the roundabout or its exit', () => {
    const own = narrateRoundabouts(route({ toward: 'Tullamore' }), words).maneuvers[1];
    expect(own.instruction).toBe(
      'Enter the roundabout and take the 2nd exit onto N52, towards Tullamore.',
    );
    expect(own.pre).toBe('Enter the roundabout and take the 2nd exit onto N52, towards Tullamore.');
    expect(own.alert).toBe('Enter the roundabout, towards Tullamore.');
    // Shown on its own line under the banner's exit and road.
    expect(own.wayOut).toBe('towards Tullamore');
    const fromExit = narrateRoundabouts(route({}, { toward: 'Birr / Dublin' }), words);
    expect(fromExit.maneuvers[1].instruction).toContain('towards Birr / Dublin');
  });

  it('says which way the exit leads when no sign does', () => {
    const r = narrateRoundabouts(route({}), words).maneuvers[1];
    expect(r.instruction).toBe('Enter the roundabout and take the 2nd exit onto N52, heading e.');
  });

  it('leaves the words alone when they name the place already, and other maneuvers', () => {
    const named = route({
      instruction: 'Enter the roundabout and take the 2nd exit toward Tullamore.',
      toward: 'Tullamore',
    });
    expect(narrateRoundabouts(named, words).maneuvers[1].instruction).toBe(
      'Enter the roundabout and take the 2nd exit toward Tullamore.',
    );
    const out = narrateRoundabouts(route({ toward: 'Tullamore' }), words);
    expect(out.maneuvers[2].instruction).toBe('Exit the roundabout onto N52.');
    expect(out.maneuvers[0].instruction).toBe('Head north.');
  });
});
