import { useSyncExternalStore } from 'react';
import type { Theme } from '../core/palette';

const query = typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-color-scheme: dark)');

const subscribe = (cb: () => void) => {
  query?.addEventListener('change', cb);
  return () => query?.removeEventListener('change', cb);
};

/** Follows the system setting; there is deliberately no in-app switch. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => (query?.matches ? 'dark' : 'light'),
    () => 'light',
  );
}
