import type * as maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { Place } from '../core/search';
import { parseShared, type Shared } from '../core/shared';
import { t } from '../i18n';
import { focusSearch } from './a11y';
import { motion } from './motion';
import { nativeLog, watchShared } from './native';
import { addressOf, spotOf, type Enrich } from './useMapTaps';

/** The address keys a shared place may come in: the web share target's, and `?geo=`. */
const KEYS = ['geo', 'title', 'text', 'url'] as const;

/**
 * Places handed over by other apps: a link opened here, a shared message, the web share
 * target. A point opens its card (its address looked up as for a dropped pin, or by the name
 * that came with it); words go to the search.
 */
export function useShared(
  map: maplibregl.Map | null,
  select: (place: Place, enrich?: Enrich) => void,
  setQuery: (q: string) => void,
) {
  /** Handed over before the map was ready: shown once it is. */
  const pending = useRef<Shared | null>(null);
  const show = useRef<(s: Shared) => void>(() => undefined);
  useEffect(() => {
    show.current = (s: Shared) => {
      if (!map) {
        pending.current = s;
        return;
      }
      pending.current = null;
      if ('query' in s) {
        setQuery(s.query);
        focusSearch();
        return;
      }
      const { at, name, zoom } = s;
      select({ name: name ?? t.droppedPin, detail: '', ...at }, () =>
        name ? addressOf(name, at) : spotOf(at),
      );
      map.flyTo({
        center: [at.lng, at.lat],
        zoom: zoom ?? Math.max(map.getZoom(), 16),
        duration: motion(1200),
      });
    };
    if (map && pending.current) show.current(pending.current);
  });

  useEffect(() => {
    const take = (text: string) => {
      const s = parseShared(text);
      if (!s) return;
      // Which kind only, never the place: the CI smoke test reads this line.
      nativeLog('info', `shared: ${'at' in s ? 'point' : 'words'}`);
      show.current(s);
    };
    // The web: the address the share target (or a link) opened the app with, then cleared.
    const params = new URLSearchParams(location.search);
    const text = KEYS.map((k) => params.get(k))
      .filter(Boolean)
      .join('\n');
    if (text) {
      for (const k of KEYS) params.delete(k);
      const rest = params.toString();
      history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}`);
      take(text);
    }
    return watchShared(take) ?? undefined;
  }, []);
}
