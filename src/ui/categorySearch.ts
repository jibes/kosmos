import type * as maplibregl from 'maplibre-gl';
import { nearest, poiFilter, type Category } from '../core/categories';
import type { Place } from '../core/search';
import { MAP_SOURCE } from '../core/style';

/** Below this zoom the tiles carry only the most important places. */
const POI_ZOOM = 14;

/**
 * Places of a category in view, nearest to its centre first. A first search from a view too
 * wide to hold them zooms in once; searching an area again never moves the map.
 */
export async function findCategory(
  map: maplibregl.Map,
  c: Category,
  lang: string,
  zoomIn: boolean,
): Promise<Place[]> {
  if (zoomIn && map.getZoom() < POI_ZOOM) {
    map.easeTo({ zoom: POI_ZOOM, duration: 700 });
    await map.once('idle');
  } else if (!map.areTilesLoaded()) {
    await map.once('idle');
  }
  // Loaded tiles reach beyond the screen (and keep earlier views); only what is in view counts.
  const view = map.getBounds();
  const pois = map
    .querySourceFeatures(MAP_SOURCE, {
      sourceLayer: 'poi',
      filter: poiFilter(c) as maplibregl.FilterSpecification,
    })
    .flatMap((f) => {
      if (f.geometry.type !== 'Point') return [];
      const [lng, lat] = f.geometry.coordinates;
      const p = f.properties;
      if (!view.contains([lng, lat])) return [];
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
