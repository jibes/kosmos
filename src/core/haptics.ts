import type { Prompt } from './nav';
import type { RidePromptKind } from './ride';
import type { Mode } from './route';

/**
 * A prompt felt instead of heard: on foot and by bike the voice starts muted (people are
 * around), so the phone in a pocket or on the handlebar buzzes instead. Vibration patterns in
 * milliseconds, on and off in turn.
 */
export const BUZZ = {
  /** The early alert: something comes up. */
  ahead: [60],
  /** Just before the maneuver: now. */
  now: [60, 90, 60],
  /** At the destination. */
  arrive: [250],
  /** Something went wrong: three short. */
  warn: [60, 90, 60, 90, 60],
} as const;

/**
 * How a prompt feels, if at all: only on foot or by bike with the voice off (a car has its
 * voice), and never for setting off or "continue for …", which ask nothing at once.
 */
export function buzzFor(
  p: Prompt,
  mode: Mode,
  muted: boolean,
  lastManeuver: number,
): readonly number[] | null {
  if (!muted || mode === 'car') return null;
  const [index, kind] = p.key.split(':');
  if (kind === 'alert') return BUZZ.ahead;
  // Setting off ("Head north …", or to the route first) asks for no turn.
  if (kind === 'pre' && Number(index) > 0) {
    return Number(index) === lastManeuver ? BUZZ.arrive : BUZZ.now;
  }
  return null;
}

/**
 * A public transport prompt felt in a pocket when the voice is off: boarding and getting off
 * like a turn, what went wrong (missed, cancelled, a new platform) as a warning, arrival long.
 * Walking to a stop and a mere delay ask nothing at once.
 */
export function rideBuzz(kind: RidePromptKind, muted: boolean): readonly number[] | null {
  if (!muted) return null;
  switch (kind) {
    case 'board':
    case 'next':
      return BUZZ.now;
    case 'missed':
    case 'cancelled':
    case 'platform':
      return BUZZ.warn;
    case 'arrived':
      return BUZZ.arrive;
    default:
      return null;
  }
}
