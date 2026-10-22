import type * as maplibregl from 'maplibre-gl';
import type { LngLat } from '../core/geo';
import { focusSearch } from './a11y';
import { routePadding } from './layout';
import { motion } from './motion';
import { logEvent } from './usageLog';

/**
 * The place card's Nearby: the map centred on the place, the search open on the kinds of place
 * (what is near here). Called in the tap itself, so a phone opens its keyboard; the focus
 * closes the card.
 */
export function showNearby(map: maplibregl.Map | null, p: LngLat, openKinds: () => void) {
  logEvent('place.nearby');
  openKinds();
  map?.easeTo({
    center: [p.lng, p.lat],
    zoom: Math.max(map.getZoom(), 15),
    padding: routePadding(),
    duration: motion(600),
  });
  focusSearch();
}
