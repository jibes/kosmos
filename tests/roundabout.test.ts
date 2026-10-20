import { describe, expect, it } from 'vitest';
import { compassOf, headingFrom, narrateWays } from '../src/core/roundabout';
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
    const own = narrateWays(route({ toward: 'Tullamore' }), words).maneuvers[1];
    expect(own.instruction).toBe(
      'Enter the roundabout and take the 2nd exit onto N52, towards Tullamore.',
    );
    expect(own.pre).toBe('Enter the roundabout and take the 2nd exit onto N52, towards Tullamore.');
    expect(own.alert).toBe('Enter the roundabout, towards Tullamore.');
    // Shown on its own line under the banner's exit and road.
    expect(own.wayOut).toBe('towards Tullamore');
    const fromExit = narrateWays(route({}, { toward: 'Birr / Dublin' }), words);
    expect(fromExit.maneuvers[1].instruction).toContain('towards Birr / Dublin');
  });

  it('shows the numbers signed at its exit', () => {
    const r = narrateWays(route({}, { refs: 'N52' }), words).maneuvers[1];
    expect(r.refs).toBe('N52');
    expect(narrateWays(route({ refs: 'R420' }, { refs: 'N52' }), words).maneuvers[1].refs).toBe(
      'R420',
    );
  });

  it('says which way the exit leads when no sign does', () => {
    const r = narrateWays(route({}), words).maneuvers[1];
    expect(r.instruction).toBe('Enter the roundabout and take the 2nd exit onto N52, heading e.');
  });

  it('leaves the words alone when they name the place already, and other maneuvers', () => {
    const named = route({
      instruction: 'Enter the roundabout and take the 2nd exit toward Tullamore.',
      toward: 'Tullamore',
    });
    const said = narrateWays(named, words).maneuvers[1];
    expect(said.instruction).toBe('Enter the roundabout and take the 2nd exit toward Tullamore.');
    // Still shown by where it leads.
    expect(said.wayOut).toBe('towards Tullamore');
    const out = narrateWays(route({ toward: 'Tullamore' }), words);
    expect(out.maneuvers[2].instruction).toBe('Exit the roundabout onto N52.');
    expect(out.maneuvers[0].instruction).toBe('Head north.');
  });

  it('says where any signed turn leads, and leaves unsigned ones to their street', () => {
    const r: Route = {
      ...route({}),
      maneuvers: [
        man({ type: 1, instruction: 'Head north.', toward: 'Nowhere' }),
        man({ type: 10, begin: 1, instruction: 'Turn right onto N52.', toward: 'Birr' }),
        man({ type: 15, begin: 2, instruction: 'Turn left onto Main Street.' }),
        man({ type: 4, begin: 4, instruction: 'You have arrived.', toward: 'Birr' }),
      ],
    };
    const [depart, right, left, arrive] = narrateWays(r, words).maneuvers;
    expect(right.instruction).toBe('Turn right onto N52, towards Birr.');
    expect(right.wayOut).toBe('towards Birr');
    expect(left.wayOut).toBeUndefined();
    expect(left.instruction).toBe('Turn left onto Main Street.');
    // Leaving and arriving name no way.
    expect(depart.wayOut).toBeUndefined();
    expect(arrive.wayOut).toBeUndefined();
  });

  it("says a junction's number where the router's words do not", () => {
    const j = (instruction: string): Route => ({
      ...route({}),
      maneuvers: [
        man({ type: 1, instruction: 'Head north.' }),
        man({
          type: 20,
          begin: 1,
          instruction,
          pre: instruction,
          junction: '14a',
          toward: 'Galway',
        }),
        man({ type: 4, begin: 4, instruction: 'You have arrived.' }),
      ],
    });
    const w = { ...words, junction: (n: string) => `exit ${n}` };
    const m = narrateWays(j('Take the ramp on the right.'), w).maneuvers[1];
    expect(m.pre).toBe('Take the ramp on the right, towards Galway, exit 14a.');
    // Said already: not twice; a road number is not the junction's.
    expect(narrateWays(j('Take exit 14a on the right.'), w).maneuvers[1].pre).toBe(
      'Take exit 14a on the right, towards Galway.',
    );
    expect(narrateWays(j('Take the ramp onto M14a.'), w).maneuvers[1].pre).toContain('exit 14a');
  });
});
