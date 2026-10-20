import { describe, expect, it } from 'vitest';
import { EDGE_PX, MIN_FREE_PX, within } from '../src/core/fitRoom';

const screen = { clientWidth: 412, clientHeight: 839 };

describe('room for a fit', () => {
  it('keeps the padding asked for while there is room', () => {
    expect(within({ top: 104, bottom: 300, left: 56, right: 96 }, screen)).toEqual({
      top: 104,
      bottom: 300,
      left: 56,
      right: 96,
    });
  });

  it('takes a tall card off its own side first, never to the edge', () => {
    // A card open to nearly the top: what is left is the map above it.
    const p = within({ top: 104, bottom: 780, left: 56, right: 96 }, screen);
    expect(screen.clientHeight - p.top - p.bottom).toBeGreaterThanOrEqual(MIN_FREE_PX);
    expect(p.top).toBe(104);
    expect(p.bottom).toBeGreaterThanOrEqual(EDGE_PX);
    // Too small a map for both: both give, neither under the edge margin.
    const tiny = within({ top: 200, bottom: 200 }, { clientWidth: 300, clientHeight: 300 });
    expect(tiny.top).toBe(tiny.bottom);
    expect(tiny.top + tiny.bottom).toBe(300 - MIN_FREE_PX);
    const tinier = within({ top: 200, bottom: 200 }, { clientWidth: 200, clientHeight: 200 });
    expect(tinier.top).toBe(EDGE_PX);
    // No padding asked: still the margin.
    expect(within({}, screen)).toEqual({
      top: EDGE_PX,
      bottom: EDGE_PX,
      left: EDGE_PX,
      right: EDGE_PX,
    });
  });
});
