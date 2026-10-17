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
}

const add = (text: string | undefined, more: string) =>
  text ? `${text.replace(/[.\s]+$/, '')}, ${more}.` : text;

/**
 * Roundabouts say which way out, not only which exit and what road: a numbered road leaves
 * in two directions. The exit's signed destination (`toward`, on the roundabout or its exit
 * maneuver), else the direction it leads, is added to the words shown and spoken.
 */
export function narrateRoundabouts(route: Route, words: ExitWords): Route {
  const ms = route.maneuvers;
  if (!ms.some((m) => m.type === ENTER)) return route;
  const maneuvers = ms.map((m, i): Maneuver => {
    if (m.type !== ENTER) return m;
    const out = ms.slice(i + 1).find((x) => x.type === EXIT) ?? ms[i + 1];
    const toward = m.toward ?? out?.toward;
    if (toward && m.instruction.includes(toward)) return m;
    const deg = out ? headingFrom(route.coords, out.begin) : null;
    if (!toward && deg === null) return m;
    const more = toward ? words.toward(toward) : words.heading(compassOf(deg!));
    return {
      ...m,
      wayOut: more,
      instruction: add(m.instruction, more)!,
      alert: add(m.alert, more),
      pre: add(m.pre, more),
    };
  });
  return { ...route, maneuvers };
}
