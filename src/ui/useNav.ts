import { useEffect, useMemo, useRef, useState } from 'react';
import {
  initialNav,
  markReroute,
  markSpoken,
  type Prompt,
  prompt,
  rerouteDue,
  sayable,
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
import { buzzFor } from '../core/haptics';
import { vibrate } from './native';
import { logEvent } from './usageLog';

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
  const tr = useMemo(
    () => (o.active && o.route ? track(o.route, o.mode) : null),
    [o.active, o.route, o.mode],
  );
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
    // "Head north on …" (a new route's first words after a reroute too) comes with the first
    // fix, as `prompt` says: on the route, or "head to the route" where it starts further off.
    let nav = initialNav();
    const { mode, subscribe } = opts.current;
    const onFix = (fix: Fix) => {
      const before = nav;
      nav = step(tr, nav, fix);
      // The usage log: guidance waiting on poor fixes, and steps passed without a word.
      const acc = Math.round(fix.accuracy);
      if (nav.weak !== before.weak) logEvent('nav.weak', { on: nav.weak, acc });
      if (nav.next > before.next + 1 && before.snap && !nav.offRoute) {
        logEvent('nav.skip', { from: before.next, to: nav.next, acc });
      }
      const found = prompt(tr, nav, mode);
      const p = found?.head ? { ...found, text: t.headToRoute } : found;
      // Said once, and only while it is still true: never about a fix from a queue.
      // The usage log: each prompt, how old its fix was, and whether it was said.
      if (p) {
        const fresh = sayable(fix.time, Date.now());
        const age = Date.now() - fix.time;
        logEvent('nav.prompt', { key: p.key, age, acc, muted: opts.current.muted, fresh });
      }
      if (p && sayable(fix.time, Date.now())) {
        nav = markSpoken(nav, p.key);
        const { muted, voice } = opts.current;
        if (!muted) voice.speak(promptWords(p));
        // Muted on foot or by bike: felt instead, in the pocket or on the handlebar.
        const buzz = buzzFor(p, mode, muted, tr.route.maneuvers.length - 1);
        if (buzz) vibrate(buzz);
      } else if (p) nav = markSpoken(nav, p.key);
      setView({ tr, nav });
      opts.current.onStep(nav, fix);
      // Never on a coarse fix, and backing off when standing in the same wrong place.
      if (nav.offRoute && !nav.arrived && !nav.weak && rerouteDue(asked.current, fix)) {
        asked.current = markReroute(asked.current, fix);
        logEvent('nav.reroute', { acc, moving: nav.moving });
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
