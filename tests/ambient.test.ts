import { describe, expect, it } from 'vitest';
import { AMBIENT_START, feedLux, type Ambient } from '../src/core/ambient';

/** Readings once a second: [lux, seconds] pairs, held for that long. */
function run(steps: [number, number][], from: Ambient = AMBIENT_START, t0 = 0) {
  let a = from;
  let t = t0;
  const seen: (boolean | null)[] = [];
  for (const [lux, secs] of steps) {
    for (let i = 0; i < secs; i++) {
      a = feedLux(a, lux, t);
      t += 1000;
    }
    seen.push(a.dark);
  }
  return { a, t, seen };
}

describe('ambient light', () => {
  it('turns dark only after a while in the dark', () => {
    expect(run([[3, 8]]).a.dark).toBeNull();
    expect(run([[3, 9]]).a.dark).toBe(true);
  });

  it('ignores a thumb over the sensor and passing shadows', () => {
    const { seen } = run([
      [20_000, 10],
      [2, 5],
      [20_000, 3],
      [2, 5],
      [20_000, 3],
    ]);
    expect(seen).toEqual([false, false, false, false, false]);
  });

  it('holds between the thresholds: a lit street at night is not daylight', () => {
    const dark = run([[3, 9]]);
    expect(run([[60, 120]], dark.a, dark.t).a.dark).toBe(true);
  });

  it('waits between switches', () => {
    // Into a car park and straight out again: dark at 8 s, light no sooner than 30 s later.
    const dark = run([[3, 9]]);
    const out = run([[5_000, 20]], dark.a, dark.t);
    expect(out.a.dark).toBe(true);
    expect(run([[5_000, 10]], out.a, out.t).a.dark).toBe(false);
  });

  it('turns light after a while in bright light', () => {
    expect(run([[500, 5]]).a.dark).toBeNull();
    expect(run([[500, 6]]).a.dark).toBe(false);
  });
});
