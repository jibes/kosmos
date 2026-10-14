import { useEffect, useMemo, useRef, useState } from 'react';
import {
  initialNav,
  markSpoken,
  type Prompt,
  prompt,
  step,
  track,
  type NavState,
  type Track,
} from '../core/nav';
import { spokenDistance, type Mode, type Route } from '../core/route';
import { fill, lang, t } from '../i18n';
import type { Fix } from './useLocation';
import type { Voice } from './voice';

/** The public router is asked again at most this often, however lost the driver is. */
const REROUTE_EVERY_MS = 30_000;

interface Options {
  route: Route | undefined;
  mode: Mode;
  active: boolean;
  subscribe: (fn: (fix: Fix) => void) => () => void;
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
  const { value, unit } = spokenDistance(p.distance);
  const n = value.toLocaleString(lang);
  const d =
    unit === 'm'
      ? fill(t.metersSpoken, { n })
      : value === 1
        ? t.oneKilometerSpoken
        : fill(t.kilometersSpoken, { n });
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
  const lastReroute = useRef(0);
  const started = useRef(false);

  useEffect(() => {
    if (!o.active) started.current = false;
  }, [o.active]);

  useEffect(() => {
    if (!tr) return;
    let nav = initialNav();
    // "Head north on …" once at the start; a reroute continues silently.
    const depart = tr.route.maneuvers[0];
    if (!started.current && depart) {
      started.current = true;
      if (!opts.current.muted) opts.current.voice.speak(depart.pre ?? depart.instruction);
    }
    nav = markSpoken(nav, '0:pre');
    const { mode, subscribe } = opts.current;
    return subscribe((fix) => {
      nav = step(tr, nav, fix);
      const p = prompt(tr, nav, mode);
      if (p) {
        nav = markSpoken(nav, p.key);
        if (!opts.current.muted) opts.current.voice.speak(promptWords(p));
      }
      setView({ tr, nav });
      opts.current.onStep(nav, fix);
      if (nav.offRoute && !nav.arrived && fix.time - lastReroute.current > REROUTE_EVERY_MS) {
        lastReroute.current = fix.time;
        opts.current.onReroute();
      }
    });
  }, [tr]);

  const nav = view.tr === tr ? view.nav : initialNav();
  return { nav, tr };
}
