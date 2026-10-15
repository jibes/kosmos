import type * as maplibregl from 'maplibre-gl';
import { useEffect } from 'react';
import { t } from '../i18n';
import { touch } from './layout';
import { HINTED_KEY, store, stored } from './prefs';

/** Streets to drop a pin on: the hint waits until the map shows them. */
const STREET_ZOOM = 13;
/** Long enough to read it and try it. */
const HINT_MS = 6000;

const hintText = () => (touch() ? t.hint : t.hintMouse);

/**
 * The one gesture nothing on screen shows, said once: the first time the map shows streets with
 * nothing open over it, and long enough to try it. A card or route opening (a long-press opens
 * one) takes the note away.
 */
export function useHint(
  map: maplibregl.Map | null,
  show: (text: string, actions: undefined, ms: number) => void,
  dismissText: (text: string) => void,
  busy: boolean,
) {
  useEffect(() => {
    if (!map) return;
    if (busy) {
      dismissText(hintText());
      return;
    }
    if (stored(HINTED_KEY)) return;
    let id = 0;
    const check = () => {
      if (id || map.getZoom() < STREET_ZOOM) return;
      id = window.setTimeout(() => {
        store(HINTED_KEY, '1');
        show(hintText(), undefined, HINT_MS);
      }, 1000);
    };
    map.on('moveend', check);
    check();
    return () => {
      clearTimeout(id);
      map.off('moveend', check);
    };
  }, [map, show, dismissText, busy]);
}
