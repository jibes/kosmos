import { useSyncExternalStore } from 'react';
import { forget, fresh, parseRecent, remember, type Recent } from '../core/recent';
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
export const forgetRecent = (r: Recent) => set(forget(list, r));

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The recent searches, newest first. */
export const useRecent = () => useSyncExternalStore(subscribe, () => list);
