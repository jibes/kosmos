import { useEffect, useMemo, useRef, useState } from 'react';
import { rideBuzz } from '../core/haptics';
import { sayable } from '../core/nav';
import {
  initialRide,
  markRideSpoken,
  ridePrompt,
  rideStep,
  type RidePrompt,
  type RideState,
} from '../core/ride';
import { vibrate } from './native';
import { DEPARTURE_CHECK_MS, tripUrl, withLiveTrip, type Transit } from '../core/transit';
import { getJson } from './http';
import type { Fix } from './useLocation';
import type { Voice } from './voice';

/** Underground there are no fixes; the timetable moves the rider on at this pace instead. */
const TICK_MS = 3000;
/** A connection planned this recently is as live as a check would make it. */
const FRESH_PLAN_MS = 3 * 60_000;

interface Options {
  transit: Transit | undefined;
  active: boolean;
  /** The latest fix, to start from; later ones arrive through `subscribe`. */
  fix: Fix | null;
  subscribe: (fn: (fix: Fix) => void) => () => void;
  voice: Voice;
  muted: boolean;
  lang: string;
  /** The words for a prompt; the core only says which. */
  say: (transit: Transit, p: RidePrompt) => string;
}

/**
 * Follows a public transport connection on every fix and every few seconds. Asks Transitous
 * only once per ride, in the last ten minutes before boarding, for its vehicle's live trip.
 */
export function useRide(o: Options) {
  const planned = o.active ? o.transit : undefined;
  const [view, setView] = useState<{ planned: Transit; live: Transit; st: RideState } | null>(null);
  const opts = useRef(o);
  useEffect(() => {
    opts.current = o;
  });

  useEffect(() => {
    if (!planned) return;
    const started = Date.now();
    let live = planned;
    let st = initialRide(live, started, opts.current.fix);
    const checked = new Set<number>();
    const ctrl = new AbortController();

    const update = (fix: Fix | null) => {
      const now = Date.now();
      st = rideStep(live, st, fix, now);
      const p = ridePrompt(live, st);
      if (p) {
        st = markRideSpoken(st, p.key);
        // Never about a fix from a queue held up meanwhile: it is no longer true.
        if (!fix || sayable(fix.time, now)) {
          if (!opts.current.muted) opts.current.voice.speak(opts.current.say(live, p));
          // Muted (every ride starts so): the phone in a pocket buzzes instead.
          const buzz = rideBuzz(p.kind, opts.current.muted);
          if (buzz) vibrate(buzz);
        }
      }
      setView({ planned, live, st });
      check(now);
    };

    /** The ride being walked to or waited for, once, when its departure is near. */
    const check = (now: number) => {
      const i = live.legs[st.leg]?.ride ? st.leg : st.leg + 1;
      const leg = live.legs[i];
      if (!leg?.ride || checked.has(i) || st.phase === 'ride') return;
      if (now < leg.start - DEPARTURE_CHECK_MS || now - started < FRESH_PLAN_MS) return;
      const url = tripUrl(leg, opts.current.lang);
      if (!url) return;
      checked.add(i);
      getJson(url, ctrl.signal)
        .then((r) => {
          const next = r.ok && withLiveTrip(live, i, r.json);
          if (!next || ctrl.signal.aborted) return;
          live = next;
          update(null);
        })
        .catch(() => undefined);
    };

    update(null);
    const off = opts.current.subscribe((fix) => update(fix));
    const id = setInterval(() => update(null), TICK_MS);
    return () => {
      ctrl.abort();
      off();
      clearInterval(id);
    };
  }, [planned]);

  return useMemo(
    () => (view && view.planned === planned ? { st: view.st, transit: view.live } : null),
    [view, planned],
  );
}
