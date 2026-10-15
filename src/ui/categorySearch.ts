import { motion } from './motion';
import { VectorTile } from '@mapbox/vector-tile';
import type * as maplibregl from 'maplibre-gl';
import { PbfReader } from 'pbf';
import { isOf, nearest, unnamedKind, type Category } from '../core/categories';
import type { LngLat } from '../core/geo';
import type { Place } from '../core/search';
import { t } from '../i18n';
import { wide } from './layout';
import { MAP_SOURCE } from '../core/style';
import { tilePoint, tilesIn, tileUrl, type TileId } from '../core/tiles';

/** A first search from a view wider than this zooms in once, so the results can be told apart. */
const SEARCH_ZOOM = 12;

interface Spot {
  props: Record<string, unknown>;
  lng: number;
  lat: number;
}

/** A tile that has not come by now is not coming; the search goes on with those that did. */
const TILE_MS = 8000;

/** Places per tile already read: searching again (another kind, the same area) costs nothing. */
const read = new Map<string, Spot[]>();

async function places(url: string, tile: TileId): Promise<Spot[]> {
  const hit = read.get(url);
  if (hit) return hit;
  const ctrl = new AbortController();
  const late = setTimeout(() => ctrl.abort(), TILE_MS);
  let body: ArrayBuffer;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(String(res.status));
    body = await res.arrayBuffer();
  } finally {
    clearTimeout(late);
  }
  const layer = new VectorTile(new PbfReader(body)).layers.poi;
  const spots: Spot[] = [];
  for (let i = 0; i < (layer?.length ?? 0); i++) {
    const f = layer.feature(i);
    const pt = f.type === 1 ? f.loadGeometry()[0]?.[0] : undefined;
    if (pt) spots.push({ props: f.properties, ...tilePoint(tile, pt.x, pt.y, layer.extent) });
  }
  if (read.size > 256) read.delete(read.keys().next().value as string);
  read.set(url, spots);
  return spots;
}

/**
 * The map the user sees: beside the side panel in the wide layout, the whole view otherwise;
 * and its middle, from which distances are measured when the user is elsewhere.
 */
function seen(map: maplibregl.Map) {
  const { width, height } = map.getCanvas().getBoundingClientRect();
  const panel = wide() ? document.querySelector('.panel')?.getBoundingClientRect() : undefined;
  const left = panel?.width ? panel.right : 0;
  const view = map.getBounds();
  const inView = (p: LngLat) =>
    view.contains([p.lng, p.lat]) && (!left || map.project([p.lng, p.lat]).x > left);
  const c = map.unproject([(left + width) / 2, height / 2]).wrap();
  return { view, inView, middle: { lng: c.lng, lat: c.lat } };
}

/**
 * Places of a category in view, nearest first: to the user when they are in view, else to the
 * middle of the map they see. The tiles on screen only hold the important places below zoom
 * 14, so this reads the zoom-14 tiles of the view itself (the same files the map loads, mostly
 * from cache). A first search from a very wide view zooms in once; searching an area again
 * never moves the map.
 */
export async function findCategory(
  map: maplibregl.Map,
  c: Category,
  lang: string,
  zoomIn: boolean,
  me: LngLat | null,
): Promise<Place[]> {
  if (zoomIn && map.getZoom() < SEARCH_ZOOM) {
    // Closer in on what the user sees (beside the panel), which stays where it is on screen:
    // the centre moves its share of the way there. (MapLibre's `around` lands elsewhere by
    // frame count while the globe turns flat, at these very zooms.) Then the view is searched
    // as it ends up, however long a slow phone takes to get there.
    const { middle } = seen(map);
    const c = map.getCenter();
    const share = 1 - 2 ** (map.getZoom() - SEARCH_ZOOM);
    const center: [number, number] = [
      c.lng + (middle.lng - c.lng) * share,
      c.lat + (middle.lat - c.lat) * share,
    ];
    await new Promise<void>((done) => {
      map.easeTo({ zoom: SEARCH_ZOOM, center, duration: motion(700) });
      if (map.isMoving()) void map.once('moveend').then(() => done());
      else done();
    });
  }
  const template = (map.getSource(MAP_SOURCE) as maplibregl.VectorTileSource | undefined)
    ?.tiles?.[0];
  if (!template) return [];
  const { view, inView, middle } = seen(map);
  const from = me && inView(me) ? me : middle;
  const tiles = tilesIn(
    { west: view.getWest(), south: view.getSouth(), east: view.getEast(), north: view.getNorth() },
    middle,
  );
  const got = await Promise.allSettled(tiles.map((tile) => places(tileUrl(template, tile), tile)));
  // Not one tile came back: offline or the tile server is down, not an empty area.
  if (tiles.length && got.every((r) => r.status === 'rejected')) throw new Error('no tiles');
  // Tiles reach beyond the screen; only what is in view counts.
  const pois = got.flatMap((r) =>
    r.status === 'fulfilled'
      ? r.value
          .filter((s) => isOf(c, s.props) && inView(s))
          .map((s) => {
            const own = s.props[`name:${lang}`] ?? s.props.name;
            const kind = unnamedKind(s.props.subclass);
            return {
              name: own ? String(own) : kind ? t[`poi_${kind}`] : '',
              unnamed: !own,
              lng: s.lng,
              lat: s.lat,
            };
          })
      : [],
  );
  return nearest(pois, from).map(({ name, unnamed, lng, lat, m }) => ({
    name,
    detail: '',
    lng,
    lat,
    distance: m,
    ...(unnamed ? { unnamed } : {}),
  }));
}
