import { distance } from './geo';
import type { Maneuver, Route } from './route';

/** The eight ways a road can lead, clockwise from north. */
export type Compass = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
const COMPASS: Compass[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** Valhalla's maneuver types for entering and leaving a roundabout. */
const ENTER = 26;
const EXIT = 27;
/** How far along the exit road its direction is read: past the roundabout's own curve. */
const AHEAD_M = 120;

const RAD = Math.PI / 180;

/** Degrees clockwise from north, from `a` to `b` ([lng, lat]). */
function bearing(a: [number, number], b: [number, number]): number {
  const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD);
  const x =
    Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) -
    Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export const compassOf = (deg: number): Compass =>
  COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Where the road leads from `begin`, about `AHEAD_M` along the route; null at its very end. */
export function headingFrom(coords: [number, number][], begin: number): number | null {
  const start = coords[begin];
  if (!start) return null;
  let far = begin;
  let run = 0;
  while (far + 1 < coords.length && run < AHEAD_M) {
    const [a, b] = [coords[far], coords[far + 1]];
    run += distance({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
    far++;
  }
  return far === begin ? null : bearing(start, coords[far]);
}

export interface ExitWords {
  /** "towards Tullamore": the exit's signed destination. */
  toward: (place: string) => string;
  /** "heading north": where the exit leads, when no sign says. */
  heading: (way: Compass) => string;
  /** "exit 12": a motorway junction's number, said when the router did not. */
  junction?: (n: string) => string;
}

const add = (text: string | undefined, more: string) =>
  text ? `${text.replace(/[.\s]+$/, '')}, ${more}.` : text;

/** Leaving, arriving and coming off a roundabout name no way of their own. */
const NO_WAY = new Set([1, 2, 3, 4, 5, 6, EXIT]);

/**
 * Where a maneuver leads, said by where the signs point rather than only the road's name or
 * number, which run both ways. Every maneuver with a signed destination (`toward`) gets it as
 * `wayOut`, added to its words unless the router said it already. Roundabouts also take the
 * signs of their exit. Only a sign names a place: a guessed town is often not the one on the
 * sign. Without one the road's own name and number stand (the banner's `road`), and a
 * roundabout says the direction its exit road leads.
 */
export function narrateWays(route: Route, words: ExitWords): Route {
  const ms = route.maneuvers;
  const maneuvers = ms.map((m, i): Maneuver => withJunction(way(m, i), words));
  return { ...route, maneuvers };

  function way(m: Maneuver, i: number): Maneuver {
    if (NO_WAY.has(m.type)) return m;
    const out =
      m.type === ENTER ? (ms.slice(i + 1).find((x) => x.type === EXIT) ?? ms[i + 1]) : undefined;
    const toward = m.toward ?? out?.toward;
    const deg = !toward && out ? headingFrom(route.coords, out.begin) : null;
    // A roundabout shows the numbers signed at its exit, as it does the places.
    if (out && !m.refs && out.refs) m = { ...m, refs: out.refs };
    if (!toward && deg === null) return m;
    const more = toward ? words.toward(toward) : words.heading(compassOf(deg!));
    // Said already ("… toward Tullamore"): shown the same way, not said twice.
    if (toward && m.instruction.includes(toward)) return { ...m, wayOut: more };
    return {
      ...m,
      wayOut: more,
      instruction: add(m.instruction, more)!,
      alert: add(m.alert, more),
      pre: add(m.pre, more),
    };
  }
}

/** A junction's number said ("…, exit 12."), unless the router's words have it already. */
function withJunction(m: Maneuver, words: ExitWords): Maneuver {
  if (!m.junction || !words.junction) return m;
  const n = m.junction.split(' / ')[0];
  const has = (text?: string) =>
    !!text &&
    new RegExp(`(^|\\W)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i').test(text);
  if (has(m.instruction)) return m;
  const said = words.junction(n);
  return {
    ...m,
    instruction: add(m.instruction, said)!,
    alert: has(m.alert) ? m.alert : add(m.alert, said),
    pre: has(m.pre) ? m.pre : add(m.pre, said),
  };
}
