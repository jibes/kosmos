import type { Prompt } from './nav';
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
} as const;

/**
 * How a prompt feels, if at all: only on foot or by bike with the voice off (a car has its
 * voice), and never for "continue for …", which asks nothing of anyone.
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
  if (kind === 'pre') return Number(index) === lastManeuver ? BUZZ.arrive : BUZZ.now;
  return null;
}
