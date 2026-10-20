/** Room around a fit, in pixels, as MapLibre takes it. */
export interface Padding {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/** Map this tall or wide at least is left for the fit itself. */
export const MIN_FREE_PX = 120;
/** Never closer to the map's edge than this, so the route's ends and their marks stay clear. */
export const EDGE_PX = 48;

/**
 * Padding that leaves some map: a card grown tall (its steps open) would cover all of it, and
 * MapLibre drops a fit that has no room left without a word. What has to give comes off the
 * larger side (the card's) first, never below `EDGE_PX` on any side.
 */
export function within(
  { top = 0, bottom = 0, left = 0, right = 0 }: Padding,
  el: { clientWidth: number; clientHeight: number },
): Required<Padding> {
  const fit = (a: number, b: number, side: number): [number, number] => {
    const room = Math.max(2 * EDGE_PX, side - MIN_FREE_PX);
    let [x, y] = [Math.max(EDGE_PX, a), Math.max(EDGE_PX, b)];
    let over = x + y - room;
    if (over <= 0) return [x, y];
    // Off the larger first, down to the smaller, then both alike.
    const cut = Math.min(over, Math.abs(x - y));
    if (x > y) x -= cut;
    else y -= cut;
    over -= cut;
    return [Math.max(EDGE_PX, x - over / 2), Math.max(EDGE_PX, y - over / 2)];
  };
  const [t, b] = fit(top, bottom, el.clientHeight);
  const [l, r] = fit(left, right, el.clientWidth);
  return { top: t, bottom: b, left: l, right: r };
}
