import type * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Category } from '../core/categories';
import { distance } from '../core/geo';
import type { Place } from '../core/search';
import { SEARCH_SOURCE } from '../core/style';
import { findCategory } from './categorySearch';

/** Moved this share of the view's width, or zoomed by a step, and the results are elsewhere. */
const MOVED_SHARE = 0.4;
const ZOOMED = 1;

/**
 * A category search on the map: its dots, "show them all", and noticing when the map has
 * moved away from where it looked, so the user can search the new area.
 */
export function useCategory(
  map: maplibregl.Map | null,
  lang: string,
  padding: () => maplibregl.PaddingOptions,
) {
  const [active, setActive] = useState<Category | null>(null);
  const [moved, setMoved] = useState(false);
  const [run, setRun] = useState(0);
  const token = useRef(0);
  const searched = useRef<{ places: Place[]; center: maplibregl.LngLat; zoom: number } | null>(
    null,
  );
  /** Our own camera moves (show all) re-anchor the search instead of counting as moving away. */
  const ownMove = useRef(false);

  const dots = useCallback(
    (places: Place[]) =>
      (map?.getSource(SEARCH_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: places.map((p) => ({
          type: 'Feature',
          properties: { name: p.name },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
      }),
    [map],
  );

  const onCategory = useCallback(
    async (c: Category | null) => {
      const mine = ++token.current;
      setActive(c);
      setMoved(false);
      if (!map || !c) {
        searched.current = null;
        dots([]);
        return [];
      }
      const places = await findCategory(map, c, lang);
      if (mine === token.current) {
        dots(places);
        searched.current = { places, center: map.getCenter(), zoom: map.getZoom() };
      }
      return places;
    },
    [map, lang, dots],
  );

  useEffect(() => {
    if (!map) return;
    const onMoveEnd = () => {
      const s = searched.current;
      if (!s) return;
      if (ownMove.current) {
        ownMove.current = false;
        searched.current = { ...s, center: map.getCenter(), zoom: map.getZoom() };
        return;
      }
      const b = map.getBounds();
      const width = distance(
        { lng: b.getWest(), lat: b.getCenter().lat },
        { lng: b.getEast(), lat: b.getCenter().lat },
      );
      const away = distance(s.center, map.getCenter()) > width * MOVED_SHARE;
      setMoved(away || Math.abs(map.getZoom() - s.zoom) >= ZOOMED);
    };
    map.on('moveend', onMoveEnd);
    return () => {
      map.off('moveend', onMoveEnd);
    };
  }, [map]);

  /** Every result on screen at once, none chosen. */
  const showAll = useCallback(() => {
    const places = searched.current?.places;
    if (!map || !places?.length) return;
    ownMove.current = true;
    if (places.length === 1) {
      map.flyTo({
        center: [places[0].lng, places[0].lat],
        zoom: Math.max(map.getZoom(), 16),
        padding: padding(),
      });
      return;
    }
    const lngs = places.map((p) => p.lng);
    const lats = places.map((p) => p.lat);
    map.fitBounds([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)], {
      padding: padding(),
      maxZoom: 17,
      duration: 900,
    });
  }, [map, padding]);

  /** Search the category again where the map is now. */
  const searchHere = useCallback(() => {
    setMoved(false);
    setRun((n) => n + 1);
  }, []);

  return { onCategory, showAll, searchHere, run, offerHere: !!active && moved };
}
