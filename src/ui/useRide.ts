import { useEffect, useMemo, useRef, useState } from 'react';
import {
  initialRide,
  markRideSpoken,
  ridePrompt,
  rideStep,
  type RidePrompt,
  type RideState,
} from '../core/ride';
import type { Transit } from '../core/transit';
import type { Fix } from './useLocation';
import type { Voice } from './voice';

/** Underground there are no fixes; the timetable moves the rider on at this pace instead. */
const TICK_MS = 3000;

interface Options {
  transit: Transit | undefined;
  active: boolean;
  subscribe: (fn: (fix: Fix) => void) => () => void;
  voice: Voice;
  muted: boolean;
  /** The words for a prompt; the core only says which. */
  say: (p: RidePrompt) => string;
}

/** Follows a public transport connection on every fix and every few seconds; asks no server. */
export function useRide(o: Options) {
  const transit = o.active ? o.transit : undefined;
  const [view, setView] = useState<{ transit: Transit; st: RideState } | null>(null);
  const opts = useRef(o);
  useEffect(() => {
    opts.current = o;
  });

  useEffect(() => {
    if (!transit) return;
    let st = initialRide(transit, Date.now());
    const update = (fix: Fix | null) => {
      st = rideStep(transit, st, fix, Date.now());
      const p = ridePrompt(transit, st);
      if (p) {
        st = markRideSpoken(st, p.key);
        if (!opts.current.muted) opts.current.voice.speak(opts.current.say(p));
      }
      setView({ transit, st });
    };
    update(null);
    const off = opts.current.subscribe((fix) => update(fix));
    const id = setInterval(() => update(null), TICK_MS);
    return () => {
      off();
      clearInterval(id);
    };
  }, [transit]);

  return useMemo(() => (view && view.transit === transit ? view.st : null), [view, transit]);
}
