import { motion } from './motion';
import { storedFetch } from './tileStore';
import { VectorTile } from '@mapbox/vector-tile';
import type * as maplibregl from 'maplibre-gl';
import { PbfReader } from 'pbf';
import { isOf, nearest, unnamedKind, type Category, type Kind } from '../core/categories';
import { isStopPoi } from '../core/departures';
import { kindOfPoi } from '../core/placeKind';
import type { LngLat } from '../core/geo';
import type { Place } from '../core/search';
import { lang as uiLang, t } from '../i18n';
import { wide } from './layout';
import { MAP_SOURCE } from '../core/style';
import { DETAIL_ZOOM, tilePoint, tilesIn, tileUrl, type TileId } from '../core/tiles';
import { placesAlong, tilesAlong } from '../core/alongRoute';
import type { Track } from '../core/nav';
import type { Town } from '../core/towns';

/** A first search from a view wider than this zooms in once, so the results can be told apart. */
const SEARCH_ZOOM = 12;

interface Spot {
  props: Record<string, unknown>;
  lng: number;
  lat: number;
}

/** A tile that has not come by now is not coming; the search goes on with those that did. */
const TILE_MS = 8000;

/**
 * Places per tile, read or on their way: searching again (another kind, the same area, the next
 * letter typed) costs nothing.
 */
const read = new Map<string, Promise<Spot[]>>();

function places(url: string, tile: TileId, layer = 'poi'): Promise<Spot[]> {
  const key = `${layer}|${url}`;
  const hit = read.get(key);
  if (hit) return hit;
  const got = fetchPlaces(url, tile, layer);
  if (read.size > 256) read.delete(read.keys().next().value as string);
  read.set(key, got);
  // A tile that failed is asked again next time.
  got.catch(() => read.get(key) === got && read.delete(key));
  return got;
}

async function fetchPlaces(url: string, tile: TileId, name: string): Promise<Spot[]> {
  const ctrl = new AbortController();
  const late = setTimeout(() => ctrl.abort(), TILE_MS);
  let body: ArrayBuffer;
  try {
    // Kept on the device as the map keeps its own: found again offline.
    body = await storedFetch(url, false, ctrl.signal);
  } finally {
    clearTimeout(late);
  }
  const layer = new VectorTile(new PbfReader(body)).layers[name];
  const spots: Spot[] = [];
  for (let i = 0; i < (layer?.length ?? 0); i++) {
    const f = layer.feature(i);
    const pt = f.type === 1 ? f.loadGeometry()[0]?.[0] : undefined;
    if (pt) spots.push({ props: f.properties, ...tilePoint(tile, pt.x, pt.y, layer.extent) });
  }
  return spots;
}

/**
 * The map the user sees: beside the side panel in the wide layout, the whole view otherwise;
 * and its middle, from which distances are measured when the user is elsewhere.
 */
export function seen(map: maplibregl.Map) {
  const { width, height } = map.getCanvas().getBoundingClientRect();
  const panel = wide() ? document.querySelector('.panel')?.getBoundingClientRect() : undefined;
  const left = panel?.width ? panel.right : 0;
  const view = map.getBounds();
  const inView = (p: LngLat) =>
    view.contains([p.lng, p.lat]) && (!left || map.project([p.lng, p.lat]).x > left);
  const c = map.unproject([(left + width) / 2, height / 2]).wrap();
  return { view, inView, middle: { lng: c.lng, lat: c.lat } };
}

/** Where distances count from: the user when in view, else the middle of the map they see. */
export function distanceFrom(map: maplibregl.Map, me: LngLat | null): LngLat {
  const { inView, middle } = seen(map);
  return me && inView(me) ? me : middle;
}

/** The map's tile URL template, once its source has loaded. */
const templateOf = (map: maplibregl.Map) =>
  (map.getSource(MAP_SOURCE) as maplibregl.VectorTileSource | undefined)?.tiles?.[0];

/** The places in some tiles; throws when not one tile came back (offline, server down). */
async function spotsIn(template: string, tiles: TileId[]) {
  const got = await Promise.allSettled(tiles.map((tile) => places(tileUrl(template, tile), tile)));
  if (tiles.length && got.every((r) => r.status === 'rejected')) throw new Error('no tiles');
  return got.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

/** The zoom-14 tiles under what the user sees, read; `null` when the map has no tiles yet. */
async function spotsInView(map: maplibregl.Map) {
  const template = templateOf(map);
  if (!template) return null;
  const { view, inView, middle } = seen(map);
  const tiles = tilesIn(
    { west: view.getWest(), south: view.getSouth(), east: view.getEast(), north: view.getNorth() },
    middle,
  );
  // Tiles reach beyond the screen; only what is in view counts, the rest is the next nearest.
  const all = await spotsIn(template, tiles);
  return { spots: all.filter(inView), all, inView, middle, template, tiles };
}

const WORLD = { west: -180, south: -85, east: 180, north: 85 };
/**
 * With none in view, the tiles around it are read nearest first, a ring at a time, until one
 * holds some: at most this many more (about 6 km around at zoom 14), and the nearest few shown.
 */
const BEYOND_TILES = 64;
const BEYOND_STEP = 16;
const BEYOND_SHOWN = 5;

async function spotsBeyond(
  { all, template, tiles: read, middle }: NonNullable<Awaited<ReturnType<typeof spotsInView>>>,
  wanted: (s: Spot) => boolean,
) {
  // The tiles under the view's edges reach past it.
  const near = all.filter(wanted);
  if (near.length) return near;
  const done = new Set(read.map((t) => tileUrl(template, t)));
  const around = tilesIn(WORLD, middle, DETAIL_ZOOM, read.length + BEYOND_TILES).filter(
    (t) => !done.has(tileUrl(template, t)),
  );
  for (let i = 0; i < around.length; i += BEYOND_STEP) {
    const found = (await spotsIn(template, around.slice(i, i + BEYOND_STEP))).filter(wanted);
    if (found.length) return found;
  }
  return [];
}

/**
 * Places of a kind in view, nearest first: to the user when they are in view, else to the
 * middle of the map they see. The tiles on screen only hold the important places below zoom
 * 14, so this reads the zoom-14 tiles of the view itself (the same files the map loads, mostly
 * from cache). A first search from a very wide view zooms in once; searching an area again
 * never moves the map.
 */
export async function findCategory(
  map: maplibregl.Map,
  kind: Kind,
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
  const got = await spotsInView(map);
  if (!got) return [];
  const { spots, inView, middle } = got;
  const from = me && inView(me) ? me : middle;
  const wanted = (s: Spot) => isOf(kind as Category, s.props);
  let found = spots.filter(wanted);
  // None in view: the nearest around it instead. (A wide view reads only its middle, so what
  // the next tiles hold may still be in view.)
  const widened = !found.length;
  if (widened) found = await spotsBeyond(got, wanted).catch(() => []);
  const pois = found.map((s) => {
    const own = s.props[`name:${lang}`] ?? s.props.name;
    const sort = unnamedKind(s.props.subclass);
    return {
      name: own ? String(own) : sort ? t[`poi_${sort}`] : '',
      unnamed: !own,
      // A stop's card shows its departures, as when its label is tapped.
      ...(isStopPoi(s.props) ? { stop: true } : {}),
      kind: kindOfPoi(s.props),
      beyond: !inView(s),
      lng: s.lng,
      lat: s.lat,
    };
  });
  return nearest(pois, from, widened ? BEYOND_SHOWN : undefined).map(
    ({ name, unnamed, beyond, stop, kind, lng, lat, m }) => ({
      name,
      detail: '',
      lng,
      lat,
      distance: m,
      ...(unnamed ? { unnamed } : {}),
      ...(beyond ? { beyond } : {}),
      ...(stop ? { stop } : {}),
      kind,
    }),
  );
}

/** A place along a route, how far along the way from here and the detour it makes (s). */
export interface AlongPlace {
  place: Place;
  ahead: number;
  detour: number;
}

/**
 * Places of a kind along the rest of a route (`core/alongRoute.ts`): the zoom-14 tiles under
 * its band ahead, read as for the map's own search and kept with them. `null` when the map has
 * no tiles yet; throws when none came back.
 */
export async function findAlong(
  map: maplibregl.Map,
  tr: Track,
  from: number,
  kind: Category,
  lang: string,
): Promise<AlongPlace[] | null> {
  const template = templateOf(map);
  if (!template) return null;
  const spots = await spotsIn(template, tilesAlong(tr, from, tr.mode));
  const pois = spots
    .filter((s) => isOf(kind, s.props))
    .map((s) => {
      const own = s.props[`name:${lang}`] ?? s.props.name;
      const sort = unnamedKind(s.props.subclass);
      return {
        name: own ? String(own) : sort ? t[`poi_${sort}`] : t[`cat_${kind}`],
        lng: s.lng,
        lat: s.lat,
        props: s.props,
        unnamed: !own,
      };
    });
  return placesAlong(tr, pois, from, tr.mode).map(({ it, ahead, detour }) => ({
    place: {
      name: it.name,
      detail: '',
      lng: it.lng,
      lat: it.lat,
      kind: kindOfPoi(it.props),
      ...(it.unnamed ? { unnamed: true } : {}),
      ...(isStopPoi(it.props) ? { stop: true } : {}),
    },
    ahead,
    detour,
  }));
}

/** The map's tiles, once known, for reading along a route away from the map (`useRoute`). */
let tileTemplate: string | undefined;
export const tilesTemplate = () => tileTemplate;
export function knowTiles(map: maplibregl.Map) {
  const set = () => {
    tileTemplate = templateOf(map) ?? tileTemplate;
  };
  set();
  map.on('sourcedata', set);
  return () => {
    map.off('sourcedata', set);
  };
}

/** Zoom 10 holds every town and village; a band this wide catches those beside the road. */
const TOWN_ZOOM = 10;
const TOWN_BAND = { band: 2_000, reach: 150_000 };
const TOWN_TILES = 40;

/**
 * The towns along a route (`core/towns.ts`), from the map's own place labels: what a road sign
 * there would most likely name. Empty when the map's tiles are not known or do not come.
 */
export async function townsAlong(tr: Track): Promise<Town[]> {
  if (!tileTemplate) return [];
  const tiles = tilesAlong(tr, 0, TOWN_BAND, TOWN_TILES, TOWN_ZOOM);
  const got = await Promise.allSettled(
    tiles.map((tile) => places(tileUrl(tileTemplate!, tile), tile, 'place')),
  );
  return got.flatMap((r) =>
    r.status === 'fulfilled'
      ? r.value.flatMap((s): Town[] => {
          const kind = s.props.class;
          const name = s.props[`name:${uiLang}`] ?? s.props.name;
          if ((kind !== 'city' && kind !== 'town' && kind !== 'village') || !name) return [];
          return [{ name: String(name), kind, lng: s.lng, lat: s.lat }];
        })
      : [],
  );
}
