import type * as maplibregl from 'maplibre-gl';
import { useCallback, useMemo, type RefObject } from 'react';
import { track } from '../core/nav';
import type { Place } from '../core/search';
import type { AlongSearch } from './AlongRoute';
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
  return useMemo(() => ({ find, onAdd: canAdd ? onAdd : undefined }), [find, onAdd, canAdd]);
}
