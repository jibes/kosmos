import type * as maplibregl from 'maplibre-gl';
import { nearest, poiFilter, type Category } from '../core/categories';
import type { Place } from '../core/search';
import { MAP_SOURCE } from '../core/style';

/** Below this zoom the tiles carry only the most important places; look closer first. */
const POI_ZOOM = 14.5;

/**
 * Places of a category in the tiles around the view, nearest to its centre first. Zooms in
 * when the view is too wide to hold them all, and waits for the tiles to arrive.
 */
export async function findCategory(
  map: maplibregl.Map,
  c: Category,
  lang: string,
): Promise<Place[]> {
  if (map.getZoom() < POI_ZOOM) {
    map.easeTo({ zoom: 15, duration: 700 });
    await map.once('idle');
  } else if (!map.areTilesLoaded()) {
    await map.once('idle');
  }
  const pois = map
    .querySourceFeatures(MAP_SOURCE, {
      sourceLayer: 'poi',
      filter: poiFilter(c) as maplibregl.FilterSpecification,
    })
    .flatMap((f) => {
      if (f.geometry.type !== 'Point') return [];
      const [lng, lat] = f.geometry.coordinates;
      const p = f.properties;
      return [{ name: String(p[`name:${lang}`] ?? p.name), lng, lat }];
    });
  const c0 = map.getCenter().wrap();
  return nearest(pois, { lng: c0.lng, lat: c0.lat }).map(({ name, lng, lat, m }) => ({
    name,
    detail: '',
    lng,
    lat,
    distance: m,
  }));
}
