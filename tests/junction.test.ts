import { describe, expect, it } from 'vitest';
import { junctionPaths, junctionsOf } from '../src/core/junction';
import { encodePolyline, type Maneuver, type Route } from '../src/core/route';

// Metres east (x) and north (y) of a point in Dublin, as [lng, lat].
const m = (x: number, y: number): [number, number] => [-6.36 + x / 66500, 53.32 + y / 111200];
const man = (type: number, begin: number): Maneuver => ({
  type,
  instruction: '',
  distance: 0,
  duration: 0,
  begin,
});
const routeOf = (coords: [number, number][], maneuvers: Maneuver[]): Route => ({
  coords,
  distance: 0,
  duration: 0,
  bbox: [0, 0, 0, 0],
  maneuvers,
});

describe('junctions from the trace', () => {
  // South 200 m to a crossroads, right (west) 200 m.
  const coords = [m(0, 200), m(0, 0), m(-200, 0)];
  const route = routeOf(coords, [man(1, 0), man(10, 1), man(4, 2)]);
  const trace = {
    shape: encodePolyline(coords),
    edges: [
      {
        begin_shape_index: 0,
        end_shape_index: 1,
        end_heading: 180,
        end_node: {
          intersecting_edges: [
            { begin_heading: 90, driveability: 'both' },
            // The other carriageway of the way in, and a footpath: not drawn by car.
            { begin_heading: 2, driveability: 'forward' },
            { begin_heading: 135, driveability: 'none', walkability: 'both' },
            { begin_heading: 180, driveability: 'both' },
          ],
        },
      },
      { begin_shape_index: 1, end_shape_index: 2, begin_heading: 270 },
    ],
  };

  it('draws a crossroads as it lies, the way out to the right', () => {
    const j = junctionsOf(trace, route, 'car');
    expect([...j.keys()]).toEqual([1]);
    expect(j.get(1)).toEqual({ kind: 'turn', out: 90, others: [-90, 0] });
    // On foot the footpath is there too.
    expect(junctionsOf(trace, route, 'foot').get(1)).toMatchObject({ others: [-90, -45, 0] });
  });

  it('knows nothing where the trace has no node at the maneuver, or none came', () => {
    const far = routeOf([m(0, 200), m(500, 500), m(-200, 0)], route.maneuvers);
    expect(junctionsOf(trace, far, 'car').size).toBe(0);
    expect(junctionsOf(null, route, 'car').size).toBe(0);
    expect(junctionsOf({ edges: [] }, route, 'car').size).toBe(0);
  });

  it('draws a turn across a dual carriageway as one crossroads, a U-turn by its arrow', () => {
    // North up a side street, left across both halves of a road running east and west.
    const c = [m(0, -200), m(0, 0), m(0, 15), m(-200, 15)];
    const r = routeOf(c, [man(1, 0), man(15, 1), man(4, 3)]);
    const trace = (out: number) => ({
      shape: encodePolyline(c),
      edges: [
        {
          begin_shape_index: 0,
          end_shape_index: 1,
          end_heading: 0,
          // The near half runs east only.
          end_node: {
            intersecting_edges: [
              { begin_heading: 90, driveability: 'forward' },
              { begin_heading: 270, driveability: 'backward' },
            ],
          },
        },
        {
          begin_shape_index: 1,
          end_shape_index: 2,
          begin_heading: 0,
          internal_intersection: true,
          // The far half runs west only; the side street goes on north.
          end_node: {
            intersecting_edges: [
              { begin_heading: 90, driveability: 'backward' },
              { begin_heading: 0, driveability: 'both' },
            ],
          },
        },
        { begin_shape_index: 2, end_shape_index: 3, begin_heading: out },
      ],
    });
    expect(junctionsOf(trace(270), r, 'car').get(1)).toEqual({
      kind: 'turn',
      out: -90,
      others: [0, 90],
    });
    expect(junctionsOf(trace(180), r, 'car').size).toBe(0);
  });

  it('draws a roundabout with the exits passed, round the way traffic goes', () => {
    // North into a roundabout, past an exit east, out north again.
    const c = [m(0, -200), m(0, -20), m(15, 0), m(0, 20), m(0, 200)];
    const r = routeOf(c, [man(1, 0), man(26, 1), man(27, 3), man(4, 4)]);
    const ring = (right: boolean) => ({
      shape: encodePolyline(c),
      edges: [
        { begin_shape_index: 0, end_shape_index: 1, end_heading: 0 },
        {
          begin_shape_index: 1,
          end_shape_index: 2,
          roundabout: true,
          drive_on_right: right,
          end_node: {
            intersecting_edges: [
              { begin_heading: 90, driveability: 'forward' },
              // An entry only: no exit to count.
              { begin_heading: 110, driveability: 'backward' },
            ],
          },
        },
        { begin_shape_index: 2, end_shape_index: 3, roundabout: true, drive_on_right: right },
        { begin_shape_index: 3, end_shape_index: 4, begin_heading: 0 },
      ],
    });
    const j = junctionsOf(ring(true), r, 'car').get(1)!;
    expect(j).toEqual({ kind: 'roundabout', out: 0, passed: [90], right: true });
    expect(junctionsOf(ring(false), r, 'car').get(1)).toMatchObject({ right: false });

    // Anticlockwise it goes round by the right-hand side; clockwise by the left.
    const xs = (d: string) => [...d.matchAll(/[ML](-?[\d.]+) /g)].map((x) => Number(x[1]));
    expect(Math.max(...xs(junctionPaths(j).way))).toBeGreaterThan(15.5);
    expect(Math.min(...xs(junctionPaths(j).way))).toBeGreaterThan(9.5);
    const left = junctionPaths({
      ...(j as Extract<typeof j, { kind: 'roundabout' }>),
      right: false,
    }).way;
    expect(Math.min(...xs(left))).toBeLessThan(8.5);
    expect(Math.max(...xs(left))).toBeLessThan(14.5);
  });

  it('draws the way in from the bottom and the way out with its arrowhead', () => {
    const { way, faint } = junctionPaths({ kind: 'turn', out: 90, others: [-90, 0] });
    expect(way.startsWith('M12 22L12.0 13.0L20.5 13.0')).toBe(true);
    expect(faint).toBe('M12.0 13.0L3.0 13.0M12.0 13.0L12.0 4.0');
  });
});
