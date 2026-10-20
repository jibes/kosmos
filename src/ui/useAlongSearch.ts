import type * as maplibregl from 'maplibre-gl';
import { useCallback, useMemo, type RefObject } from 'react';
import { track } from '../core/nav';
import type { Place } from '../core/search';
import type { AlongSearch } from './AlongRoute';
import { ALONG_SOURCE } from '../core/style';
import { findAlong } from './categorySearch';

/** Search along a route on this map, and a stop made of what is found while one can be added. */
export function useAlongSearch(
  map: maplibregl.Map | null,
  lang: string,
  addStopRef: RefObject<(p: Place) => void>,
  canAdd: boolean,
): AlongSearch {
  const find = useCallback<AlongSearch['find']>(
    (route, mode, from, kind) =>
      map ? findAlong(map, track(route, mode), from, kind, lang) : Promise.resolve(null),
    [map, lang],
  );
  const onAdd = useCallback((p: Place) => addStopRef.current(p), [addStopRef]);
  /** The places found as dots on the map, tappable like its labels; none to clear them. */
  const show = useCallback(
    (places: Place[]) =>
      void (map?.getSource(ALONG_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: places.map((p) => ({
          type: 'Feature',
          properties: { name: p.name },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
      }),
    [map],
  );
  return useMemo(
    () => ({ find, show, onAdd: canAdd ? onAdd : undefined }),
    [find, show, onAdd, canAdd],
  );
}
