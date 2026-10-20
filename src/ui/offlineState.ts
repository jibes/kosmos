import { useSyncExternalStore } from 'react';

/** Tiles fetched for later so far, of how many. */
export interface Fetching {
  done: number;
  total: number;
}

/** What is being kept for offline now: the world, a trip's way (About shows it). */
let state: { world: Fetching | null; trip: Fetching | null } = { world: null, trip: null };
const listeners = new Set<() => void>();

export function setFetching(which: 'world' | 'trip', f: Fetching | null) {
  state = { ...state, [which]: f };
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useFetching = () => useSyncExternalStore(subscribe, () => state);
