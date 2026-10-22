import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { BUZZ } from '../core/haptics';
import { distance, type LngLat } from '../core/geo';
import type { Mode } from '../core/route';
import type { Place } from '../core/search';
import { leavingStop, SKIP_DELAY_MS, type StopWatch } from '../core/stops';
import { fill, t } from '../i18n';
import { vibrate } from './native';
import { logEvent } from './usageLog';

export interface SkipOptions {
  navigating: boolean;
  via: Place[];
  /** Stops reached so far; the next one is watched. */
  behind: number;
  setBehind: Dispatch<SetStateAction<number>>;
  fix: LngLat | null;
  offRoute: boolean;
  mode: Mode;
  /** Says it, or buzzes when the voice is off. */
  say: (text: string) => boolean;
  showToast: (text: string, actions: { label: string; run: () => void }[], ms: number) => void;
  dismissText: (text: string) => void;
  /** Asks the router again, now without the stop skipped. */
  reroute: () => void;
}

/**
 * A stop left behind while guiding (another way taken, the user driving off from it): asked
 * aloud and on screen whether to skip it, and skipped by itself after `SKIP_DELAY_MS` unless
 * kept. A stop kept is not asked about again on this drive.
 */
export function useStopSkip(o: SkipOptions) {
  const opts = useRef(o);
  useEffect(() => {
    opts.current = o;
  });
  const watch = useRef<StopWatch | null>(null);
  /** By their points: a stop's index shifts as others are taken off or added. */
  const kept = useRef(new Set<string>());
  const asking = useRef<{
    stop: number;
    at: string;
    timer: ReturnType<typeof setTimeout>;
    text: string;
  } | null>(null);

  const { navigating, via, behind, fix, offRoute, mode } = o;
  useEffect(() => {
    if (navigating) return;
    watch.current = null;
    kept.current.clear();
    if (asking.current) clearTimeout(asking.current.timer);
    asking.current = null;
  }, [navigating]);

  useEffect(() => {
    if (!navigating) return;
    // Reached, skipped or taken off meanwhile: the question is moot.
    const at = (p: Place | undefined) => (p ? `${p.lng},${p.lat}` : '');
    if (
      asking.current &&
      (asking.current.stop < behind || at(via[asking.current.stop]) !== asking.current.at)
    ) {
      clearTimeout(asking.current.timer);
      opts.current.dismissText(asking.current.text);
      asking.current = null;
    }
    if (!fix || behind >= via.length) return;
    const stop = via[behind];
    if (asking.current || kept.current.has(at(stop))) return;
    const next = leavingStop(watch.current, behind, distance(fix, stop), offRoute, mode);
    watch.current = next.watch;
    if (!next.leaving) return;

    const i = behind;
    const { say, showToast, dismissText } = opts.current;
    const text = fill(t.skipStopAsk, { name: stop.name });
    const done = () => {
      if (asking.current?.stop !== i) return;
      clearTimeout(asking.current.timer);
      dismissText(text);
      asking.current = null;
    };
    const skip = () => {
      if (asking.current?.stop !== i) return;
      done();
      logEvent('stop.skip');
      opts.current.setBehind((b) => Math.max(b, i + 1));
      opts.current.reroute();
    };
    const keep = () => {
      done();
      logEvent('stop.keep');
      kept.current.add(at(stop));
    };
    asking.current = { stop: i, at: at(stop), timer: setTimeout(skip, SKIP_DELAY_MS), text };
    if (!say(fill(t.saySkipStop, { name: stop.name, n: SKIP_DELAY_MS / 1000 }))) {
      vibrate(BUZZ.warn);
    }
    showToast(
      text,
      [
        { label: t.skipNow, run: skip },
        { label: t.keepStop, run: keep },
      ],
      SKIP_DELAY_MS,
    );
  }, [navigating, via, behind, fix, offRoute, mode]);
}
