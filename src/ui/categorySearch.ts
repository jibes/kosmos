import { motion } from './motion';
import { VectorTile } from '@mapbox/vector-tile';
import type * as maplibregl from 'maplibre-gl';
import { PbfReader } from 'pbf';
import {
  isOf,
  NAME_MIN,
  nameOf,
  nearest,
  sharedName,
  squeeze,
  unnamedKind,
  type Category,
  type Kind,
} from '../core/categories';
import type { LngLat } from '../core/geo';
import type { Place } from '../core/search';
import { t } from '../i18n';
import { wide } from './layout';
import { MAP_SOURCE } from '../core/style';
import { DETAIL_ZOOM, tilePoint, tilesIn, tileUrl, type TileId } from '../core/tiles';

/** A first search from a view wider than this zooms in once, so the results can be told apart. */
const SEARCH_ZOOM = 12;

interface Spot {
  props: Record<string, unknown>;
  lng: number;
  lat: number;
  /** Its name to compare by (`squeeze`), worked out once. */
  key?: string;
}

const keyOf = (s: Spot) => (s.key ??= s.props.name ? squeeze(String(s.props.name)) : '');

/** A tile that has not come by now is not coming; the search goes on with those that did. */
const TILE_MS = 8000;

/**
 * Places per tile, read or on their way: searching again (another kind, the same area, the next
 * letter typed) costs nothing.
 */
const read = new Map<string, Promise<Spot[]>>();

function places(url: string, tile: TileId): Promise<Spot[]> {
  const hit = read.get(url);
  if (hit) return hit;
  const got = fetchPlaces(url, tile);
  if (read.size > 256) read.delete(read.keys().next().value as string);
  read.set(url, got);
  // A tile that failed is asked again next time.
  got.catch(() => read.get(url) === got && read.delete(url));
  return got;
}

async function fetchPlaces(url: string, tile: TileId): Promise<Spot[]> {
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

/** Names are read as they are typed only from this close in: a few tiles, not a city's worth. */
const NAMES_ZOOM = 13;

/**
 * The name several places in view share that the text begins ("media" → MediaMarkt, 3), from
 * the zoom-14 tiles of the view; nothing from a wide view or without tiles.
 */
export async function sharedNameInView(map: maplibregl.Map, text: string) {
  const q = squeeze(text);
  if (map.getZoom() < NAMES_ZOOM || q.length < NAME_MIN) return null;
  const got = await spotsInView(map).catch(() => null);
  const names = (got?.spots ?? []).filter((s) => keyOf(s).startsWith(q));
  // The same place from two neighbouring tiles counts once.
  const once = nearest(
    names.map((s) => ({ name: String(s.props.name), lng: s.lng, lat: s.lat })),
    got?.middle ?? { lng: 0, lat: 0 },
    Infinity,
  );
  const shared = sharedName(
    text,
    once.map((p) => p.name),
  );
  if (!shared) return null;
  // Where they are: Photon's rows for the same branches would only repeat them.
  const key = squeeze(shared.name);
  return { ...shared, at: once.filter((p) => squeeze(p.name).startsWith(key)) };
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
  const name = nameOf(kind);
  const key = name === null ? undefined : squeeze(name);
  const wanted = (s: Spot) =>
    key === undefined ? isOf(kind as Category, s.props) : !!key && keyOf(s).startsWith(key);
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
      beyond: !inView(s),
      lng: s.lng,
      lat: s.lat,
    };
  });
  return nearest(pois, from, widened ? BEYOND_SHOWN : undefined).map(
    ({ name, unnamed, beyond, lng, lat, m }) => ({
      name,
      detail: '',
      lng,
      lat,
      distance: m,
      ...(unnamed ? { unnamed } : {}),
      ...(beyond ? { beyond } : {}),
    }),
  );
}
