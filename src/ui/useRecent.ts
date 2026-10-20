import { useSyncExternalStore } from 'react';
import { forget, fresh, parseRecent, recentPlaceOf, remember, type Recent } from '../core/recent';
import type { Place } from '../core/search';
import { t } from '../i18n';
import { RECENT_KEY, store, stored } from './prefs';

/** One list for every search field (the place search and the route's own), kept on the device. */
let list: Recent[] = fresh(parseRecent(stored(RECENT_KEY)), Date.now());
const listeners = new Set<() => void>();

function set(next: Recent[]) {
  list = next;
  store(RECENT_KEY, JSON.stringify(next));
  for (const l of listeners) l();
}

/** A search taken now. */
export const rememberRecent = (r: Recent extends infer R ? Omit<R, 'at'> : never) => {
  const now = Date.now();
  set(remember(list, { ...r, at: now } as Recent, now));
};
/**
 * A place worth finding again: chosen from the names found, or one from the map the user did
 * something with (a route, sharing, a star, what is nearby). Opening a card alone is not
 * enough, as eight are kept and every tap would push out the searches.
 */
export const rememberPlace = (p: Place) => {
  const place = recentPlaceOf(p, t.droppedPin);
  if (place) rememberRecent({ place });
};
export const forgetRecent = (r: Recent) => set(forget(list, r));

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The recent searches, newest first. */
export const useRecent = () => useSyncExternalStore(subscribe, () => list);
