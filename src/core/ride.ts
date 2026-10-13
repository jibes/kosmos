import type { LngLat } from './geo';
import type { Stop, Transit, TransitLeg } from './transit';

/**
 * Following a public transport connection on the device: walk to the stop, wait, ride, get off,
 * walk on. Pure, like `nav.ts`: fixes and time come in as arguments. Above ground the position
 * decides; underground, where fixes stop, the timetable does.
 */

const R = 6371008.8;
const RAD = Math.PI / 180;

/** A fix older than this says nothing about where the rider is now. */
export const FRESH_MS = 20_000;
/** A walk ends this close to its stop (or the destination). */
export const AT_STOP_M = 40;
/** Farther than this from the line, a fix is not on the vehicle. */
const NEAR_LINE_M = 200;
/** Still this far from the stop when the vehicle leaves: missed. */
const MISSED_M = 300;
/** Announce boarding this long before departure. */
const BOARD_AHEAD_MS = 120_000;

export type Phase = 'walk' | 'wait' | 'ride' | 'arrived';

export interface Fix extends LngLat {
  time: number;
}

export interface RideState {
  /** Index of the current leg; `legs.length` once arrived. */
  leg: number;
  phase: Phase;
  /** Riding: stops until getting off, 1 meaning the next stop is yours. */
  stopsLeft: number;
  /** Walking: metres left on this walk. */
  toGo: number;
  /** The vehicle this walk leads to has left without the rider. */
  missed: boolean;
  fix: Fix | null;
  time: number;
  spoken: string[];
}

/** Metres along a line to the point nearest `p`, and how far `p` is from the line. */
function project(coords: [number, number][], p: LngLat) {
  const k = Math.cos(p.lat * RAD);
  const xy = ([lng, lat]: [number, number]) => [
    (lng - p.lng) * RAD * R * k,
    (lat - p.lat) * RAD * R,
  ];
  let walked = 0;
  const best = { along: 0, offset: Infinity, total: 0 };
  for (let i = 1; i < coords.length; i++) {
    const [ax, ay] = xy(coords[i - 1]);
    const [bx, by] = xy(coords[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    const f = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (len * len))) : 0;
    const d = Math.hypot(ax + f * dx, ay + f * dy);
    if (d < best.offset) Object.assign(best, { along: walked + f * len, offset: d });
    walked += len;
  }
  best.total = walked;
  return best;
}

const metres = (a: LngLat, b: LngLat) => {
  const k = Math.cos(((a.lat + b.lat) / 2) * RAD);
  return Math.hypot((b.lng - a.lng) * k, b.lat - a.lat) * RAD * R;
};

/** Every stop of a ride after boarding, the last one being where to get off. */
const stopsOf = (l: TransitLeg): (Stop & { arrival?: number })[] => [
  ...l.via,
  { ...l.to, arrival: l.end },
];

function legDone(legs: TransitLeg[], i: number, fix: Fix | null, time: number): boolean {
  const l = legs[i];
  const next = legs[i + 1];
  const d = fix ? metres(fix, l.to) : Infinity;
  if (l.ride) {
    if (time < l.start) return false;
    return (time >= l.end - 60_000 && (!fix || d < MISSED_M)) || time >= l.end + 120_000;
  }
  if (fix && d < AT_STOP_M) return true;
  // No position: trust the timetable once the next vehicle has left, or the walk is long over.
  if (next?.ride) return time >= next.start && (!fix || d < MISSED_M);
  return !fix && time >= l.end + 120_000;
}

function evaluate(tr: Transit, prev: RideState, seen: Fix | null, time: number): RideState {
  const legs = tr.legs;
  const fix = seen && time - seen.time < FRESH_MS ? seen : null;
  let leg = prev.leg;
  while (leg < legs.length && legDone(legs, leg, fix, time)) leg++;
  const base = { ...prev, leg, fix: seen, time, missed: false };
  if (leg >= legs.length) return { ...base, phase: 'arrived', stopsLeft: 0, toGo: 0 };

  const l = legs[leg];
  if (!l.ride) {
    const on = fix && project(l.coords, fix);
    const toGo = on && on.offset < NEAR_LINE_M ? Math.max(0, on.total - on.along) : l.distance;
    const next = legs[leg + 1];
    const missed =
      !!next?.ride && !!fix && time > next.start + 30_000 && metres(fix, l.to) > MISSED_M;
    return { ...base, phase: 'walk', toGo, stopsLeft: 0, missed };
  }

  const stops = stopsOf(l);
  if (time < l.start) return { ...base, phase: 'wait', stopsLeft: stops.length, toGo: 0 };
  // Position along the line where there is one; otherwise stops whose arrival is still ahead.
  let left: number;
  const on = fix && project(l.coords, fix);
  if (on && on.offset < NEAR_LINE_M) {
    left = stops.filter((s) => project(l.coords, s).along > on.along + 30).length;
  } else {
    left = stops.filter(
      (s, i) => (s.arrival ?? l.start + ((i + 1) / stops.length) * (l.end - l.start)) > time,
    ).length;
  }
  return { ...base, phase: 'ride', stopsLeft: Math.max(1, left), toGo: 0 };
}

export function initialRide(tr: Transit, time: number, fix: Fix | null = null): RideState {
  const empty: RideState = {
    leg: 0,
    phase: 'walk',
    stopsLeft: 0,
    toGo: 0,
    missed: false,
    fix: null,
    time,
    spoken: [],
  };
  return evaluate(tr, empty, fix, time);
}

/** Moves the rider on with a new fix, or with time alone (`fix` null) where there is none. */
export function rideStep(tr: Transit, st: RideState, fix: Fix | null, time: number): RideState {
  return evaluate(tr, st, fix ?? st.fix, time);
}

export type RidePromptKind = 'walk' | 'board' | 'next' | 'arrived';

export interface RidePrompt {
  key: string;
  kind: RidePromptKind;
  /** The leg the prompt is about: the walk, the ride to board or to leave. */
  leg: number;
}

/** What to say now, if anything; each prompt is said once (see `markRideSpoken`). */
export function ridePrompt(tr: Transit, st: RideState): RidePrompt | null {
  const said = (k: string) => st.spoken.includes(k);
  const ask = (kind: RidePromptKind, leg: number) =>
    said(`${leg}:${kind}`) ? null : { key: `${leg}:${kind}`, kind, leg };
  if (st.phase === 'arrived') return ask('arrived', tr.legs.length);
  if (st.phase === 'walk') {
    const walk = ask('walk', st.leg);
    if (walk) return walk;
    const next = tr.legs[st.leg + 1];
    return next?.ride && !st.missed && st.time >= next.start - BOARD_AHEAD_MS
      ? ask('board', st.leg + 1)
      : null;
  }
  if (st.phase === 'wait') return ask('board', st.leg);
  return st.stopsLeft === 1 ? ask('next', st.leg) : null;
}

export const markRideSpoken = (st: RideState, key: string): RideState => ({
  ...st,
  spoken: [...st.spoken, key],
});
