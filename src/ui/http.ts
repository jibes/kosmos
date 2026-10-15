import { CapacitorHttp } from '@capacitor/core';
import { NOMINATIM_URL } from '../core/details';
import { ROUTER_URL } from '../core/route';
import { TRANSIT_URL } from '../core/transit';
import { isNative } from './native';

/** The volunteer services (Transitous, Nominatim, the FOSSGIS router) ask apps to name
 * themselves; a browser cannot set User-Agent (its Referer has to do), the app can. */
const USER_AGENT = `kOSMos/${__BUILD__.version} (+https://github.com/jibes/kosmos)`;

/** The native request cannot be aborted; it gives up by itself after this. */
const NATIVE_TIMEOUT_MS = 15_000;

/** Rejects once the signal aborts: the caller stops waiting even where the request goes on. */
const aborted = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    const stop = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });

/** GET as JSON; `ok` false on an HTTP error, a throw only when there is no answer at all. */
export async function getJson(url: string, signal: AbortSignal) {
  if (isNative && [TRANSIT_URL, NOMINATIM_URL, ROUTER_URL].some((s) => url.startsWith(s))) {
    const res = await Promise.race([
      CapacitorHttp.get({
        url,
        headers: { 'User-Agent': USER_AGENT },
        connectTimeout: NATIVE_TIMEOUT_MS,
        readTimeout: NATIVE_TIMEOUT_MS,
      }),
      aborted(signal),
    ]);
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json: res.data };
  }
  const res = await fetch(url, { signal });
  return { ok: res.ok, status: res.status, json: res.ok ? await res.json() : null };
}

let nominatimNext = 0;

/** How long until the next Nominatim slot is free, without taking it. */
export const nominatimWait = () => Math.max(0, nominatimNext - Date.now());

/**
 * Reserves the next Nominatim slot and returns the milliseconds to wait for it. One request a
 * second across the whole app (place details and the search fallback), as the OSMF asks.
 */
export function nominatimSlot(): number {
  const now = Date.now();
  const at = Math.max(now, nominatimNext);
  nominatimNext = at + 1100;
  return at - now;
}
