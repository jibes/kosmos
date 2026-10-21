import { describe, expect, it } from 'vitest';
import { snap, snapNear, track } from '../src/core/nav';
import type { Route } from '../src/core/route';

// Metres east (x) and north (y) of a point in the Midlands, as [lng, lat].
const m = (x: number, y: number): [number, number] => [-7.5 + x / 66500, 53.27 + y / 111200];

describe('snapping many points near a long road', () => {
  // 150 km of winding road in 6000 points, 400 places around it.
  const long: Route = {
    coords: Array.from({ length: 6000 }, (_, i) => m(i * 25, Math.sin(i / 50) * 300)),
    distance: 150_000,
    duration: 6000,
    bbox: [0, 0, 0, 0],
    maneuvers: [],
  };
  const points = Array.from({ length: 400 }, (_, i) => {
    const [lng, lat] = m((i * 397) % 150_000, ((i * 7919) % 8000) - 4000);
    return { lng, lat };
  });

  it('finds the same as snapping each onto the whole road, in a blink', () => {
    const tr = track(long);
    const near = 2_000;
    const slow = points.map((p) => {
      const s = snap(tr, p);
      return s.offset <= near ? Math.round(s.along) : null;
    });
    const t0 = performance.now();
    const fast = snapNear(tr, points, near).map((s) =>
      s && s.offset <= near ? Math.round(s.along) : null,
    );
    expect(performance.now() - t0).toBeLessThan(500);
    expect(fast).toEqual(slow);
  });
});
