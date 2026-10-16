import { useEffect, useState } from 'react';
import { parseDepartures, stopTimesUrl, type Departure } from '../core/departures';
import type { Place } from '../core/search';
import { getJson } from './http';

/** The same stop opened again soon (back from a route, a second look): no new request. */
const KEEP_MS = 60_000;
const cache = new Map<string, { at: number; list: Departure[] }>();

/**
 * The next departures from a stop's card: one request to Transitous when the card opens, kept
 * a minute, never polled. `undefined` while it loads, `null` when Transitous did not answer.
 */
export function useDepartures(place: Place, lang: string): Departure[] | null | undefined {
  const { stop, lng, lat } = place;
  const key = stop ? `${lat.toFixed(5)},${lng.toFixed(5)}|${lang}` : '';
  const [result, setResult] = useState<{ key: string; list: Departure[] | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    const kept = cache.get(key);
    if (kept && Date.now() - kept.at < KEEP_MS) return;
    const ctrl = new AbortController();
    getJson(stopTimesUrl({ lng, lat }, lang), ctrl.signal)
      .then((r) => {
        if (ctrl.signal.aborted) return;
        const list = r.ok ? parseDepartures(r.json, Date.now()) : null;
        if (list) cache.set(key, { at: Date.now(), list });
        setResult({ key, list });
      })
      .catch(() => !ctrl.signal.aborted && setResult({ key, list: null }));
    return () => ctrl.abort();
  }, [key, lng, lat, lang]);

  if (!key) return [];
  // The newest answer for this stop; the one kept from before while a new one comes.
  return result?.key === key ? result.list : cache.get(key)?.list;
}
