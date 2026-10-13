import { CapacitorHttp } from '@capacitor/core';
import { TRANSIT_URL } from '../core/transit';
import { isNative } from './native';

/** Transitous asks apps to name themselves; a browser cannot set User-Agent, the app can. */
const USER_AGENT = `kOSMos/${__BUILD__.version} (+https://github.com/jibes/kosmos)`;

/** GET as JSON; `ok` false on an HTTP error, a throw only when there is no answer at all. */
export async function getJson(url: string, signal: AbortSignal) {
  if (isNative && url.startsWith(TRANSIT_URL)) {
    const res = await CapacitorHttp.get({ url, headers: { 'User-Agent': USER_AGENT } });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json: res.data };
  }
  const res = await fetch(url, { signal });
  return { ok: res.ok, status: res.status, json: res.ok ? await res.json() : null };
}
