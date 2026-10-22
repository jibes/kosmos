import type { LngLat } from './geo';
import type { Stop, Transit, TransitLeg, WalkStep } from './transit';

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
/** Within this of where to get off, a ride is over once it is due. */
const MISSED_M = 300;
/** Announce boarding this long before departure. */
const BOARD_AHEAD_MS = 120_000;
/** Vehicles leave a little late; reaching the stop this long after departure may still catch it. */
const DEPART_GRACE_MS = 30_000;
/** On the line but short of the stop after the planned arrival: running late, for this long. */
const LATE_MAX_MS = 60 * 60_000;
/** On board a vehicle that has left: this close to its line and this far along it. */
const ON_LINE_M = 40;
const PAST_STOP_M = 60;
/** Still at the stop this long after the departure, not along the line: it left without them. */
const LEFT_BEHIND_MS = 3 * 60_000;

export type Phase = 'walk' | 'wait' | 'ride' | 'arrived';

export interface Fix extends LngLat {
  time: number;
  /** Metres, when known: a stop is "here" within it, never tighter than `AT_STOP_M`. */
  accuracy?: number;
}

/** How close to a stop counts as at it with this fix. */
const atStop = (fix: Fix) => Math.max(AT_STOP_M, Math.min(fix.accuracy ?? 0, 100));

export interface RideState {
  /** Index of the current leg; `legs.length` once arrived. */
  leg: number;
  phase: Phase;
  /** Riding: stops until getting off, 1 meaning the next stop is yours. */
  stopsLeft: number;
  /** Walking: metres left on this walk. */
  toGo: number;
  /** Walking with a position: the next turn and the metres to it. */
  turn: (WalkStep & { in: number }) | null;
  /** The vehicle this walk leads to has left without the rider. */
  missed: boolean;
  /** The vehicle ahead (to board or waited for) does not run. */
  cancelled: boolean;
  fix: Fix | null;
  time: number;
  spoken: string[];
  /** A ride entered on the timetable alone (no fix at its departure): the next fix may still
   * show the rider at the stop, and the vehicle gone. */
  blind: number | null;
  /** Metres along the current ride's line at the last fix on it. */
  rideAt: number | null;
}

/**
 * Metres along a line to the point nearest `p`, and how far `p` is from the line. With
 * `window`, a match within it wins over a nearer one elsewhere: a line that comes back along
 * the same street must not jump the rider to its other side.
 */
function project(coords: [number, number][], p: LngLat, window?: [number, number]) {
  const all = projectIn(coords, p);
  if (!window) return all;
  const near = projectIn(coords, p, window);
  return near.offset < NEAR_LINE_M ? { ...near, total: all.total } : all;
}

function projectIn(coords: [number, number][], p: LngLat, window?: [number, number]) {
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
    let f = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (len * len))) : 0;
    if (window && len) {
      if (walked + len < window[0] || walked > window[1]) {
        walked += len;
        continue;
      }
      f = Math.max((window[0] - walked) / len, Math.min((window[1] - walked) / len, f));
    }
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

/** Every stop of a ride after boarding, the last one being where to get off; stops the
 * vehicle no longer calls at (live data) are not counted. */
const stopsOf = (l: TransitLeg): (Stop & { arrival?: number })[] => [
  ...l.via.filter((v) => !v.skipped),
  { ...l.to, arrival: l.end },
];

/** Where each stop lies along the ride's line, never going back (lines that loop). */
function stopsAlong(l: TransitLeg, stops: Stop[]): number[] {
  let last = 0;
  return stops.map((s) => (last = Math.max(last, project(l.coords, s).along)));
}

function legDone(legs: TransitLeg[], i: number, fix: Fix | null, time: number): boolean {
  const l = legs[i];
  const next = legs[i + 1];
  const d = fix ? metres(fix, l.to) : Infinity;
  if (l.ride) {
    // A vehicle that does not run is never ridden; the rider needs another connection.
    if (l.cancelled || time < l.start) return false;
    // Ending at the destination: only a position says so (below), never the timetable.
    const last = !next;
    // No position (underground): the timetable moves the rider on.
    if (!fix) return !last && time >= l.end + 120_000;
    // At the stop to get off, whenever: a vehicle ahead of its timetable too.
    if (d < atStop(fix)) return true;
    const on = project(l.coords, fix);
    if (on.offset < NEAR_LINE_M) {
      const stops = stopsOf(l);
      const before = stops.length > 1 ? stopsAlong(l, stops).at(-2)! : 0;
      // Past the stop before it and nearly there, when due: getting off (a big station's
      // point may lie a way from its platforms). Never at the stop before, however close.
      if (on.along > before + 30 && d < MISSED_M && time >= l.end - 60_000) return true;
      // At the end of the line already.
      if (on.along >= on.total - 30) return true;
      // On the line and short of the stop: riding, late or not, for up to an hour.
      return !last && time >= l.end + LATE_MAX_MS;
    }
    // Away from the line and from the stop: the timetable decides.
    return !last && time >= l.end + 120_000;
  }
  if (next?.ride) {
    // No position: trust the timetable once the vehicle has left (provisionally, see `blind`).
    if (!fix) return time >= next.start;
    // Nothing to catch: the walk ends at the stop, where the rider learns it does not run.
    if (next.cancelled) return d < atStop(fix);
    // At the stop in time; after departure only a fix carried along the line means on board.
    if (time <= next.start + DEPART_GRACE_MS) return d < atStop(fix);
    const on = project(next.coords, fix);
    return on.offset < Math.max(ON_LINE_M, fix.accuracy ?? 0) && on.along > PAST_STOP_M;
  }
  // The destination: only a position there says so, never the timetable alone.
  return !!fix && d < atStop(fix);
}

function evaluate(tr: Transit, prev: RideState, seen: Fix | null, time: number): RideState {
  const legs = tr.legs;
  const fix = seen && time - seen.time < FRESH_MS ? seen : null;
  let leg = prev.leg;
  let blind = prev.blind;
  // Boarded on the timetable alone: a first fix still at the stop, not along the line, after
  // the departure, means the vehicle left without the rider; also once the timetable has
  // carried the rider past that ride.
  if (fix && blind !== null && leg >= blind) {
    const l = legs[blind];
    const on = project(l.coords, fix);
    if (
      time > l.start + DEPART_GRACE_MS &&
      metres(fix, l.from) < MISSED_M &&
      on.along < PAST_STOP_M
    )
      leg = blind - 1;
    blind = null;
  }
  // At the destination itself, from the last ride on (or got there another way, the ride
  // ahead missed or cancelled): arrived, whatever the timetable says.
  let lastRide = -1;
  legs.forEach((l, i) => l.ride && (lastRide = i));
  const dest = legs[legs.length - 1]?.to;
  const anyWay = leg >= lastRide || prev.missed || prev.cancelled;
  if (fix && dest && anyWay && metres(fix, dest) < atStop(fix)) leg = legs.length;
  while (leg < legs.length && legDone(legs, leg, fix, time)) {
    // A walk to a vehicle done without a position is only provisional.
    if (!fix && !legs[leg].ride && legs[leg + 1]?.ride) blind = leg + 1;
    leg++;
  }
  const rideAt = leg === prev.leg ? prev.rideAt : null;
  const base = {
    ...prev,
    leg,
    blind,
    rideAt,
    fix: seen,
    time,
    missed: false,
    cancelled: false,
    turn: null,
  };
  if (leg >= legs.length) return { ...base, phase: 'arrived', stopsLeft: 0, toGo: 0 };

  const l = legs[leg];
  if (!l.ride) {
    const on = fix && project(l.coords, fix);
    const near = on && on.offset < NEAR_LINE_M ? on : null;
    // Off the walk's line, as the crow flies; without a fresh fix, what it was.
    const toGo = near
      ? Math.max(0, near.total - near.along)
      : fix
        ? metres(fix, l.to)
        : prev.leg === leg && prev.phase === 'walk' && prev.toGo > 0
          ? prev.toGo
          : l.distance;
    // The next real turn ahead; "depart" and "straight on" are not worth saying.
    const step = near
      ? l.steps.find((s) => s.at > near.along + 5 && s.turn !== 'straight' && s.turn !== 'depart')
      : undefined;
    const turn = step ? { ...step, in: step.at - near!.along } : null;
    const next = legs[leg + 1];
    // Still walking once the vehicle has left (the walk ends on board): missed.
    const cancelled = !!next?.ride && next.cancelled;
    const missed = !!next?.ride && !cancelled && !!fix && time > next.start + DEPART_GRACE_MS;
    return { ...base, phase: 'walk', toGo, stopsLeft: 0, missed, cancelled, turn };
  }

  const stops = stopsOf(l);
  if (l.cancelled)
    return { ...base, phase: 'wait', stopsLeft: stops.length, toGo: 0, cancelled: true };
  if (time < l.start) return { ...base, phase: 'wait', stopsLeft: stops.length, toGo: 0 };
  // Still standing at the stop well after it left (a late vehicle takes the rider along the
  // line, which ends this): waiting, and the new connection is offered.
  if (fix && time > l.start + LEFT_BEHIND_MS && metres(fix, l.from) < atStop(fix)) {
    const at = project(l.coords, fix);
    if (at.along < PAST_STOP_M)
      return { ...base, phase: 'wait', stopsLeft: stops.length, toGo: 0, missed: true };
  }
  // Position along the line where there is one; otherwise stops whose arrival is still ahead.
  let left: number;
  // From the last position on the line, a vehicle covers at most this much: no jumping to
  // the other side of a line that comes back along the same street.
  const reach: [number, number] | undefined =
    base.rideAt !== null && fix && prev.fix
      ? [base.rideAt - 100, base.rideAt + 200 + 40 * Math.max(0, (fix.time - prev.fix.time) / 1000)]
      : undefined;
  const on = fix && project(l.coords, fix, reach);
  if (on && on.offset < NEAR_LINE_M) {
    const along = stopsAlong(l, stops);
    const margin = Math.max(30, fix.accuracy ?? 0);
    left = along.filter((a) => a > on.along + margin).length;
    base.rideAt = on.along;
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
    turn: null,
    missed: false,
    cancelled: false,
    fix: null,
    time,
    spoken: [],
    blind: null,
    rideAt: null,
  };
  return evaluate(tr, empty, fix, time);
}

/** Moves the rider on with a new fix, or with time alone (`fix` null) where there is none. */
export function rideStep(tr: Transit, st: RideState, fix: Fix | null, time: number): RideState {
  return evaluate(tr, st, fix ?? st.fix, time);
}

export type RidePromptKind =
  'walk' | 'board' | 'next' | 'arrived' | 'missed' | 'cancelled' | 'platform' | 'delay';

export interface RidePrompt {
  key: string;
  kind: RidePromptKind;
  /** The leg the prompt is about: the walk, the ride to board or to leave. */
  leg: number;
}

/** A delay this long, in minutes, is worth saying. */
const SAY_DELAY_MIN = 3;

/**
 * What to say now, if anything; each prompt is said once (see `markRideSpoken`). Besides the
 * way, what changed: a departure missed or cancelled, a new platform, a delay (each new value
 * once), so a rider with the phone in a pocket hears it.
 */
export function ridePrompt(tr: Transit, st: RideState): RidePrompt | null {
  const said = (k: string) => st.spoken.includes(k);
  const ask = (kind: RidePromptKind, leg: number, what = '') => {
    const key = `${leg}:${kind}${what ? `:${what}` : ''}`;
    return said(key) ? null : { key, kind, leg };
  };
  /** Changes to the ride about to be boarded. */
  const changes = (i: number) => {
    const r = tr.legs[i];
    if (st.cancelled) return ask('cancelled', i);
    if (r.from.track && r.from.scheduledTrack && r.from.track !== r.from.scheduledTrack) {
      const p = ask('platform', i, r.from.track);
      if (p) return p;
    }
    return r.delay >= SAY_DELAY_MIN ? ask('delay', i, String(r.delay)) : null;
  };
  if (st.phase === 'arrived') return ask('arrived', tr.legs.length);
  if (st.phase === 'walk') {
    const walk = ask('walk', st.leg);
    if (walk) return walk;
    const next = tr.legs[st.leg + 1];
    if (!next?.ride) return null;
    if (st.missed) return ask('missed', st.leg + 1);
    const change = changes(st.leg + 1);
    if (change || st.cancelled) return change;
    return st.time >= next.start - BOARD_AHEAD_MS ? ask('board', st.leg + 1) : null;
  }
  if (st.phase === 'wait') {
    if (st.missed) return ask('missed', st.leg);
    return changes(st.leg) ?? (st.cancelled ? null : ask('board', st.leg));
  }
  // Not while still at the stop boarded at (a ride of one stop, its vehicle late): once moving.
  const moving = st.rideAt === null || st.rideAt > PAST_STOP_M;
  return st.stopsLeft === 1 && moving ? ask('next', st.leg) : null;
}

export const markRideSpoken = (st: RideState, key: string): RideState => ({
  ...st,
  spoken: [...st.spoken, key],
});
