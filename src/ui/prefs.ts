import type { TravelMode } from '../core/route';

/** Small choices the app remembers on this device. */
/** Voice off while driving (`useMuted`); other travel modes always start silent. */
export const MUTED_KEY = 'kosmos.muted.v1';
export const MODE_KEY = 'kosmos.mode.v1';
export const HINTED_KEY = 'kosmos.hinted.v1';
/** The last searches taken (`core/recent.ts`); never leaves the device. */
export const RECENT_KEY = 'kosmos.recent.v1';

/** Starred places (`core/favourites.ts`); never leave the device. */
export const FAVOURITES_KEY = 'kosmos.favourites.v1';

/** The usage log, kept only when the user turns it on (`ui/usageLog.ts`); never leaves the device
 * unless saved. */
export const LOG_KEY = 'kosmos.log.v1';
export const LOGGING_KEY = 'kosmos.logging.v1';

export const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; still applies for this session.
  }
};

export const storedMuted = () => stored(MUTED_KEY) === '1';

/** Routes open in the travel mode used last: walkers and riders should not switch every time. */
export const storedMode = (): TravelMode => {
  const m = stored(MODE_KEY);
  return m === 'bike' || m === 'foot' || m === 'transit' ? m : 'car';
};
