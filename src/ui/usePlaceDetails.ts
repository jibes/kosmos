import { useEffect, useState } from 'react';
import { isOsmId, lookupUrl, parseLookup, type Details } from '../core/details';
import { getJson, nominatimSlot } from './http';

const cache = new Map<string, Details>();

/** Opening hours and contacts for a place with an OSM id; `undefined` while they load. */
export function usePlaceDetails(osm: string | undefined, lang: string): Details | undefined {
  const [result, setResult] = useState<{ osm: string; details: Details } | null>(null);

  useEffect(() => {
    if (!osm || !isOsmId(osm) || cache.has(osm)) return;
    const ctrl = new AbortController();
    // Nominatim: one request a second; flicking through places waits its turn, and a card
    // closed before its turn never asks.
    const timer = setTimeout(() => {
      getJson(lookupUrl(osm, lang), ctrl.signal)
        .then((r) => {
          const details = r.ok ? parseLookup(r.json) : {};
          if (r.ok) cache.set(osm, details);
          if (!ctrl.signal.aborted) setResult({ osm, details });
        })
        .catch(() => !ctrl.signal.aborted && setResult({ osm, details: {} }));
    }, nominatimSlot());
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [osm, lang]);

  if (!osm || !isOsmId(osm)) return {};
  return cache.get(osm) ?? (result?.osm === osm ? result.details : undefined);
}
