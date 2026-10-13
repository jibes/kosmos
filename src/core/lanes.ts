import type { Mode } from './route';

/**
 * Lane guidance from Valhalla's `turn_lanes`: which lanes lead into the next maneuver. Shown
 * only when there is a choice to make, small while it is still far, large once it matters.
 */

/** One lane, left to right, as Valhalla sends it: bitmasks of turn directions. */
export interface Lane {
  directions: number;
  /** The direction to take here without changing lanes again. */
  active?: number;
  /** A direction that works here, though another lane is better. */
  valid?: number;
}

export type LaneArrow =
  | 'sharp-left'
  | 'left'
  | 'slight-left'
  | 'straight'
  | 'slight-right'
  | 'right'
  | 'sharp-right'
  | 'uturn'
  | 'merge-left'
  | 'merge-right';

/** Valhalla's bits, in the order arrows are drawn. */
const BITS: [number, LaneArrow][] = [
  [256, 'uturn'],
  [4, 'sharp-left'],
  [8, 'left'],
  [16, 'slight-left'],
  [2, 'straight'],
  [32, 'slight-right'],
  [64, 'right'],
  [128, 'sharp-right'],
  [512, 'merge-left'],
  [1024, 'merge-right'],
];

export type LaneUse = 'best' | 'ok' | 'no';

export interface LaneView {
  use: LaneUse;
  /** Every arrow painted on the lane; `on` for the ones that follow the route. */
  arrows: { arrow: LaneArrow; on: boolean }[];
}

/** Parses Valhalla's `lanes`; anything malformed or a single lane is no guidance. */
export function parseLanes(raw: unknown): Lane[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2) return undefined;
  const lanes: Lane[] = [];
  for (const l of raw as Record<string, unknown>[]) {
    if (typeof l?.directions !== 'number') return undefined;
    lanes.push({
      directions: l.directions,
      ...(typeof l.active === 'number' ? { active: l.active } : {}),
      ...(typeof l.valid === 'number' ? { valid: l.valid } : {}),
    });
  }
  return lanes;
}

export function laneViews(lanes: Lane[]): LaneView[] {
  return lanes.map((l) => {
    const use: LaneUse = l.active ? 'best' : l.valid ? 'ok' : 'no';
    const go = l.active ?? l.valid ?? 0;
    // An unmarked lane (0 or "none") goes straight on.
    const painted = l.directions & ~1 || go || 2;
    const arrows = BITS.filter(([bit]) => painted & bit).map(([bit, arrow]) => ({
      arrow,
      on: !!(go & bit),
    }));
    return { use, arrows };
  });
}

/** Lanes matter only when some lead the right way and some do not. */
export function lanesNeeded(lanes: Lane[] | undefined): lanes is Lane[] {
  if (!lanes) return false;
  const views = laneViews(lanes);
  return views.some((v) => v.use !== 'no') && views.some((v) => v.use === 'no');
}

export type LaneSize = 'none' | 'small' | 'big';

/** From when lanes show (small) and when they take over (big): distance or seconds ahead. */
const SHOW: Record<Mode, { m: number; s: number }> = {
  car: { m: 600, s: 40 },
  bike: { m: 200, s: 25 },
  foot: { m: 0, s: 0 },
};
const BIG: Record<Mode, { m: number; s: number }> = {
  car: { m: 150, s: 12 },
  bike: { m: 60, s: 10 },
  foot: { m: 0, s: 0 },
};

export function laneSize(toNext: number, speed: number, mode: Mode): LaneSize {
  const at = (r: { m: number; s: number }) => Math.max(r.m, speed * r.s);
  if (toNext <= at(BIG[mode])) return BIG[mode].m ? 'big' : 'none';
  if (toNext <= at(SHOW[mode])) return 'small';
  return 'none';
}
