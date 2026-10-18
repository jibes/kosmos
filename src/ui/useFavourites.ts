import type * as maplibregl from 'maplibre-gl';
import { useEffect, useSyncExternalStore } from 'react';
import {
  favouriteFeatures,
  isFavourite,
  mergeFavourites,
  parseFavourites,
  renameFavourite,
  titleOf,
  toggleFavourite,
  type Favourite,
} from '../core/favourites';
import type { Place } from '../core/search';
import { FAV_ICON, FAV_SOURCE } from '../core/style';
import { FAVOURITES_KEY, store, stored } from './prefs';
import { logEvent } from './usageLog';

/** One list for the whole app: the place card stars, the search lists, the map marks. */
let list: Favourite[] = parseFavourites(stored(FAVOURITES_KEY));
const listeners = new Set<() => void>();

function set(next: Favourite[]) {
  list = next;
  store(FAVOURITES_KEY, JSON.stringify(next));
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useFavourites = () => useSyncExternalStore(subscribe, () => list);
/** The list now, outside React (a tap on a star). */
export const favouriteAt = (i: number): Favourite | undefined => list[i];
export const favouritesNow = () => list;

/** Star or unstar a place. */
export function toggleFavouritePlace(p: Place) {
  const on = !isFavourite(list, p);
  logEvent('favourite', { on });
  set(toggleFavourite(list, p, Date.now()));
}

/** Its own name for a starred place, or the place's again (empty). */
export function renameFavouritePlace(p: Place, label: string) {
  logEvent('favourite.rename', { named: !!label.trim() });
  set(renameFavourite(list, p, label));
}

/** Favourites from a backup, added to these; how many were new. */
export function restoreFavourites(restored: Favourite[]): number {
  const next = mergeFavourites(list, restored);
  const added = next.length - list.length;
  set(next);
  return added;
}

const placeRest = ({ lng, lat, osm, kind, stop }: Favourite) => ({
  lng,
  lat,
  ...(osm ? { osm } : {}),
  ...(kind ? { kind } : {}),
  ...(stop ? { stop } : {}),
});

/** The place a favourite stands for: as it was starred, by the user's name for it, the
 * place's own name then in front of the detail. Its card opens from it. */
export const placeOf = (f: Favourite): Place => ({
  name: titleOf(f),
  detail: f.label ? [f.name, f.detail].filter(Boolean).join(', ') : f.detail,
  ...placeRest(f),
});

/** A five-pointed star, white on clear, tinted by the style (an SDF image), with room around it
 * for the halo that lifts it off the map. */
function star(size = 56): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const [cx, cy, outer, inner] = [size / 2, size / 2 + size * 0.03, size * 0.36, size * 0.155];
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  g.closePath();
  g.fillStyle = '#fff';
  g.fill();
  return g.getImageData(0, 0, size, size);
}

/** The favourites on the map, kept in step with the list; the star drawn when a style asks. */
export function useFavouriteLayer(map: maplibregl.Map | null) {
  const favourites = useFavourites();
  useEffect(() => {
    if (!map) return;
    // There before any tile is laid out (one laid out without it keeps no star), and again for
    // each new style; asked for on the spot as well, should a tile be quicker.
    const ensure = () => {
      if (!map.hasImage(FAV_ICON)) map.addImage(FAV_ICON, star(), { sdf: true, pixelRatio: 2 });
    };
    const missing = (e: { id: string }) => {
      if (e.id === FAV_ICON) ensure();
    };
    if (map.isStyleLoaded()) ensure();
    map.on('styledata', ensure);
    map.on('styleimagemissing', missing);
    return () => {
      map.off('styledata', ensure);
      map.off('styleimagemissing', missing);
    };
  }, [map]);
  useEffect(() => {
    if (!map) return;
    const apply = () =>
      (map.getSource(FAV_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
        favouriteFeatures(favourites),
      );
    // The map is handed out before its style has loaded: the source comes with it.
    if (map.getSource(FAV_SOURCE)) apply();
    else map.once('load', apply);
    return () => {
      map.off('load', apply);
    };
  }, [map, favourites]);
}
