import type * as maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { Place } from '../core/search';
import { parseShared, type Shared } from '../core/shared';
import { lookupUrl, parseLookup, parseLookupPlace } from '../core/details';
import { lang, t } from '../i18n';
import { getJson, nominatimSlot } from './http';
import { knowDetails } from './usePlaceDetails';
import { focusSearch } from './a11y';
import { motion } from './motion';
import { nativeLog, watchShared } from './native';
import { addressOf, spotOf, type Enrich } from './useMapTaps';

/** An OSM object by its id, through Nominatim's one-a-second slot; `null` when not found. */
async function lookUp(osm: string) {
  // Its turn reserved at once: another lookup asked meanwhile waits for the next one.
  await new Promise((go) => setTimeout(go, nominatimSlot()));
  try {
    const r = await getJson(lookupUrl(osm, lang), new AbortController().signal);
    if (!r.ok) return null;
    knowDetails(osm, parseLookup(r.json));
    return parseLookupPlace(r.json);
  } catch {
    return null;
  }
}

/** The address keys a shared place may come in: the web share target's, and `?geo=`. */
const KEYS = ['geo', 'title', 'text', 'url'] as const;

/**
 * Places handed over by other apps: a link opened here, a shared message, the web share
 * target. A point opens its card (its address looked up as for a dropped pin, or by the name
 * that came with it); words go to the search.
 */
/** The app's own way of showing a shared place, for an OSM link pasted into the search. */
let opener: ((s: Shared) => void) | null = null;
export const openShared = (s: Shared) => opener?.(s);

export function useShared(
  map: maplibregl.Map | null,
  select: (place: Place, enrich?: Enrich) => void,
  setQuery: (q: string) => void,
  /** A route open is closed for it; guidance is never taken over: it waits until it ends. */
  trip: { guiding: boolean; open: boolean; close: () => void; note: (text: string) => void },
) {
  /** Handed over before the map was ready, or while guiding: shown once it can be. */
  const pending = useRef<Shared | null>(null);
  const show = useRef<(s: Shared) => void>(() => undefined);
  useEffect(() => {
    show.current = (s: Shared) => {
      if (!map || trip.guiding) {
        if (map && pending.current !== s) trip.note(t.sharedLater);
        pending.current = s;
        return;
      }
      pending.current = null;
      if (trip.open) trip.close();
      if ('query' in s) {
        setQuery(s.query);
        focusSearch();
        return;
      }
      if ('osm' in s) {
        // One lookup by its id, the same the card would make, so the card asks nothing more.
        lookUp(s.osm).then((found) => {
          if (!found) return setQuery('');
          const { lng, lat, name, detail } = found;
          select({ name: name ?? t.droppedPin, detail, lng, lat, osm: s.osm });
          map.flyTo({
            center: [lng, lat],
            zoom: Math.max(map.getZoom(), 16),
            duration: motion(1200),
          });
        });
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
    opener = (s) => show.current(s);
  });

  useEffect(() => {
    const take = (text: string) => {
      const s = parseShared(text);
      if (!s) return;
      // Which kind only, never the place: the CI smoke test reads this line.
      nativeLog('info', `shared: ${'at' in s ? 'point' : 'osm' in s ? 'object' : 'words'}`);
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
