import { useEffect, useMemo, useRef, useState } from 'react';
import {
  initialNav,
  markReroute,
  markSpoken,
  type Prompt,
  prompt,
  rerouteDue,
  step,
  track,
  type NavState,
  type RerouteMark,
  type Track,
} from '../core/nav';
import { spokenDistance, type Mode, type Route } from '../core/route';
import { fill, locale, t, units } from '../i18n';
import type { Fix } from './useLocation';
import type { Voice } from './voice';

/** A fix this recent counts at once when guidance starts: the arrow need not wait for the next. */
export const FRESH_MS = 10_000;

interface Options {
  route: Route | undefined;
  mode: Mode;
  active: boolean;
  subscribe: (fn: (fix: Fix) => void) => () => void;
  /** The latest fix before guidance began, if any. */
  last?: Fix | null;
  voice: Voice;
  muted: boolean;
  /** Called after every fix with the new state, for the camera and the user's arrow. */
  onStep: (nav: NavState, fix: Fix) => void;
  onReroute: () => void;
}

/**
 * What to say for a prompt: the router's words, with "In 500 meters" in front when the prompt
 * carries a distance. After a comma (English) the instruction goes on in lower case; a colon
 * (German) keeps its capital, which nouns need.
 */
export function promptWords(p: Prompt): string {
  if (p.distance === undefined) return p.text;
  const { value, unit } = spokenDistance(p.distance, units);
  const n = value.toLocaleString(locale);
  const words = {
    m: [t.metersSpoken, t.metersSpoken],
    km: [t.oneKilometerSpoken, t.kilometersSpoken],
    ft: [t.feetSpoken, t.feetSpoken],
    yd: [t.yardsSpoken, t.yardsSpoken],
    mi: [t.oneMileSpoken, t.milesSpoken],
  }[unit];
  const d = fill(value === 1 ? words[0] : words[1], { n });
  const text = /,\s*\{text\}/.test(t.inDistance)
    ? p.text.charAt(0).toLowerCase() + p.text.slice(1)
    : p.text;
  return fill(t.inDistance, { d, text });
}

/** Runs guidance for the current route on every fix; the router is never polled. */
export function useNav(o: Options) {
  const tr = useMemo(() => (o.active && o.route ? track(o.route) : null), [o.active, o.route]);
  const [view, setView] = useState<{ tr: Track | null; nav: NavState }>({
    tr: null,
    nav: initialNav(),
  });
  const opts = useRef(o);
  useEffect(() => {
    opts.current = o;
  });
  /** The last time the router was asked for a new route, and where. */
  const asked = useRef<RerouteMark | null>(null);

  useEffect(() => {
    if (!o.active) asked.current = null;
  }, [o.active]);

  useEffect(() => {
    if (!tr) return;
    let nav = initialNav();
    // "Head north on …" at the start, and a new route's first words after a reroute.
    const depart = tr.route.maneuvers[0];
    if (depart && !opts.current.muted) opts.current.voice.speak(depart.pre ?? depart.instruction);
    nav = markSpoken(nav, '0:pre');
    const { mode, subscribe } = opts.current;
    const onFix = (fix: Fix) => {
      nav = step(tr, nav, fix);
      const p = prompt(tr, nav, mode);
      if (p) {
        nav = markSpoken(nav, p.key);
        if (!opts.current.muted) opts.current.voice.speak(promptWords(p));
      }
      setView({ tr, nav });
      opts.current.onStep(nav, fix);
      // Never on a coarse fix, and backing off when standing in the same wrong place.
      if (nav.offRoute && !nav.arrived && !nav.weak && rerouteDue(asked.current, fix)) {
        asked.current = markReroute(asked.current, fix);
        opts.current.onReroute();
      }
    };
    const off = subscribe(onFix);
    // Where the user already is counts at once: the arrow and camera need not wait for a fix.
    const last = opts.current.last;
    if (last && Date.now() - last.time < FRESH_MS) onFix(last);
    return off;
  }, [tr]);

  const nav = view.tr === tr ? view.nav : initialNav();
  return { nav, tr };
}
