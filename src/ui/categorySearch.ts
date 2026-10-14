import { VectorTile } from '@mapbox/vector-tile';
import type * as maplibregl from 'maplibre-gl';
import { PbfReader } from 'pbf';
import { isOf, nearest, type Category } from '../core/categories';
import type { Place } from '../core/search';
import { MAP_SOURCE } from '../core/style';
import { tilePoint, tilesIn, tileUrl, type TileId } from '../core/tiles';

/** A first search from a view wider than this zooms in once, so the results can be told apart. */
const SEARCH_ZOOM = 12;

interface Spot {
  props: Record<string, unknown>;
  lng: number;
  lat: number;
}

/** Places per tile already read: searching again (another kind, the same area) costs nothing. */
const read = new Map<string, Spot[]>();

async function places(url: string, tile: TileId): Promise<Spot[]> {
  const hit = read.get(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const layer = new VectorTile(new PbfReader(await res.arrayBuffer())).layers.poi;
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
 * Places of a category in view, nearest to its centre first. The tiles on screen only hold the
 * important places below zoom 14, so this reads the zoom-14 tiles of the view itself (the same
 * files the map loads, mostly from cache). A first search from a very wide view zooms in once;
 * searching an area again never moves the map.
 */
export async function findCategory(
  map: maplibregl.Map,
  c: Category,
  lang: string,
  zoomIn: boolean,
): Promise<Place[]> {
  if (zoomIn && map.getZoom() < SEARCH_ZOOM) {
    map.easeTo({ zoom: SEARCH_ZOOM, duration: 700 });
    await new Promise((done) => setTimeout(done, 750));
  }
  const template = (map.getSource(MAP_SOURCE) as maplibregl.VectorTileSource | undefined)
    ?.tiles?.[0];
  if (!template) return [];
  const view = map.getBounds();
  const c0 = map.getCenter().wrap();
  const center = { lng: c0.lng, lat: c0.lat };
  const tiles = tilesIn(
    { west: view.getWest(), south: view.getSouth(), east: view.getEast(), north: view.getNorth() },
    center,
  );
  const got = await Promise.allSettled(tiles.map((t) => places(tileUrl(template, t), t)));
  // Not one tile came back: offline or the tile server is down, not an empty area.
  if (tiles.length && got.every((r) => r.status === 'rejected')) throw new Error('no tiles');
  // Tiles reach beyond the screen; only what is in view counts.
  const pois = got.flatMap((r) =>
    r.status === 'fulfilled'
      ? r.value
          .filter((s) => isOf(c, s.props) && view.contains([s.lng, s.lat]))
          .map((s) => ({
            name: String(s.props[`name:${lang}`] ?? s.props.name),
            lng: s.lng,
            lat: s.lat,
          }))
      : [],
  );
  return nearest(pois, center).map(({ name, lng, lat, m }) => ({
    name,
    detail: '',
    lng,
    lat,
    distance: m,
  }));
}
