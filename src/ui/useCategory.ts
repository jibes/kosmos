import type * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { foundOf, nearBest, nearest, type Kind } from '../core/categories';
import { distance, type LngLat } from '../core/geo';
import type { Place } from '../core/search';
import { SEARCH_SOURCE } from '../core/style';
import { findCategory, seen, sharedNameInView } from './categorySearch';
import { motion } from './motion';
import { logEvent } from './usageLog';

const SEARCH_LAYERS = ['search-dots', 'search-names'];

const anchor = (map: maplibregl.Map) => ({ center: map.getCenter(), zoom: map.getZoom() });

/**
 * A camera move the user asked for, though the app makes it (the location button): passed as
 * the move's event data, it counts like their own pan, so the results may be elsewhere now.
 */
export const ASKED = { asked: true } as const;

/** Moved this share of the view's width, or zoomed by a step, and the results are elsewhere. */
const MOVED_SHARE = 0.4;
const ZOOMED = 1;

/**
 * A category (or chain) search on the map: its dots, "show them all", and noticing when the map has
 * moved away from where it looked, so the user can search the new area.
 */
export function useCategory(
  map: maplibregl.Map | null,
  lang: string,
  padding: () => maplibregl.PaddingOptions,
  /** A route is open: the dots step aside for it and come back after, search and all. */
  hidden: boolean,
  /** The user's position: distances count from there when it is in view. */
  me: LngLat | null,
  /** The camera goes to the results: following the position would pull it off them. */
  onFit: () => void,
) {
  const onFitRef = useRef(onFit);
  useEffect(() => {
    onFitRef.current = onFit;
  });
  const meRef = useRef(me);
  useEffect(() => {
    meRef.current = me;
  });
  const [active, setActive] = useState<Kind | null>(null);
  const [moved, setMoved] = useState(false);
  const movedRef = useRef(moved);
  useEffect(() => {
    movedRef.current = moved;
  });
  const [run, setRun] = useState(0);
  const token = useRef(0);
  const searched = useRef<{
    places: Place[];
    /** What "show all" fits: all of them, or for names the best and those near it. */
    fit: Place[];
    center: maplibregl.LngLat;
    zoom: number;
  } | null>(null);
  /** What the map shows now, for the results sheet; `failed` when the tiles did not come. */
  const [results, setResults] = useState<{
    kind: Kind;
    places: Place[];
    failed?: boolean;
  } | null>(null);
  const last = useRef<Kind | null>(null);

  /** The result whose dot stands out, by its place in the list. */
  const hot = useRef<number | null>(null);
  const dots = useCallback(
    (places: Place[]) => {
      const source = map?.getSource(SEARCH_SOURCE) as maplibregl.GeoJSONSource | undefined;
      // New results: none stands out yet (states outlive the data, by id).
      if (source) map?.removeFeatureState({ source: SEARCH_SOURCE });
      hot.current = null;
      return source?.setData({
        type: 'FeatureCollection',
        // Ids in the list's order, so a row can light up its dot (`highlight`).
        features: places.map((p, id) => ({
          type: 'Feature',
          id,
          properties: { name: p.name, ...(p.stop ? { stop: true } : {}) },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
      });
    },
    [map],
  );

  /** Every one of `places` on screen at once, none chosen. */
  const fit = useCallback(
    (places: Place[]) => {
      if (!map || !places.length) return;
      onFitRef.current();
      if (places.length === 1) {
        map.flyTo({
          center: [places[0].lng, places[0].lat],
          zoom: Math.max(map.getZoom(), 16),
          padding: padding(),
          duration: motion(1200),
        });
        return;
      }
      const lngs = places.map((p) => p.lng);
      const lats = places.map((p) => p.lat);
      map.fitBounds([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)], {
        padding: padding(),
        absolutePadding: true,
        maxZoom: 17,
        duration: motion(900),
      });
    },
    [map, padding],
  );

  /**
   * Shows a kind of place on the map, or (`found:`) the places `given` by a name search: those
   * nearest first, and the view fitted to the best and those near it at once.
   */
  const onCategory = useCallback(
    async (c: Kind | null, given?: Place[]) => {
      const mine = ++token.current;
      setActive(c);
      setMoved(false);
      if (!map || !c) {
        last.current = null;
        searched.current = null;
        setResults(null);
        dots([]);
        return [];
      }
      if (foundOf(c) !== null) {
        last.current = c;
        const { inView, middle } = seen(map);
        const me = meRef.current;
        const from = me && inView(me) ? me : middle;
        const near = nearBest(given ?? []);
        const places = nearest(given ?? [], from, Infinity).map(({ m, ...p }) => ({
          ...p,
          distance: m,
        }));
        dots(places);
        setResults({ kind: c, places });
        searched.current = { places, fit: near, ...anchor(map) };
        // Once the list has closed, so the fit measures the map the user will see.
        requestAnimationFrame(() => fit(near));
        return places;
      }
      // A new category may zoom in from a wide view; the same one again searches in place.
      const fresh = c !== last.current;
      last.current = c;
      setResults((r) => (r?.kind === c ? r : null));
      try {
        const places = await findCategory(map, c, lang, fresh, meRef.current);
        if (mine === token.current) {
          dots(places);
          setResults({ kind: c, places });
          searched.current = { places, fit: places, ...anchor(map) };
        }
        return places;
      } catch (e) {
        if (mine === token.current) setResults({ kind: c, places: [], failed: true });
        throw e;
      }
    },
    [map, lang, dots, fit],
  );

  useEffect(() => {
    if (!map) return;
    const show = () => {
      for (const id of SEARCH_LAYERS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', hidden ? 'none' : 'visible');
      }
    };
    show();
    // A theme or language change builds the style anew, with the layers visible.
    map.on('styledata', show);
    return () => {
      map.off('styledata', show);
    };
  }, [map, hidden]);

  useEffect(() => {
    if (!map) return;
    // Only the user's own panning and zooming moves away from results, told by how a move
    // ends: a drag or a fling with the gesture's own event, the app's camera (locate, follow,
    // show all) without one, also when it cuts a fling short (locate tapped while the map still
    // glides). The app's moves re-anchor the results and take back an offer already made.
    const onMoveEnd = (e: { originalEvent?: Event; asked?: boolean }) => {
      const s = searched.current;
      if (!s) return;
      if (!e.originalEvent && !e.asked) {
        // The app's own move (following the position, show all): the results move with it,
        // unless the user has already looked elsewhere, which stands.
        if (!movedRef.current) {
          searched.current = { ...s, ...anchor(map) };
        }
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

  /**
   * Every result on screen at once, none chosen: back where they are. With the map moved away
   * (the offer up) the search key means here instead, as the offer does.
   */
  const showAll = useCallback(() => {
    setMoved(false);
    const c = last.current;
    if (movedRef.current && c && foundOf(c) === null) {
      setRun((n) => n + 1);
      return;
    }
    fit(searched.current?.fit ?? []);
  }, [fit]);

  /** The dot of the `index`th result stands out; `null` puts it back. */
  const highlight = useCallback(
    (index: number | null) => {
      const source = map?.getSource(SEARCH_SOURCE) ? SEARCH_SOURCE : null;
      if (!map || !source || hot.current === index) return;
      if (hot.current !== null) map.setFeatureState({ source, id: hot.current }, { hot: false });
      if (index !== null) map.setFeatureState({ source, id: index }, { hot: true });
      hot.current = index;
    },
    [map],
  );

  /** The name several places in view share that a text begins: a chain to search for. */
  const names = useCallback(
    (text: string) => (map ? sharedNameInView(map, text) : Promise.resolve(null)),
    [map],
  );

  /** Search the category again where the map is now. */
  const searchHere = useCallback(() => {
    logEvent('search.here.tap');
    setMoved(false);
    setRun((n) => n + 1);
  }, []);

  // Names found are Photon's answer, not the map's: there is no area to search again.
  const offerHere = !!active && foundOf(active) === null && moved;
  useEffect(() => {
    if (offerHere) logEvent('search.here.offer');
  }, [offerHere]);
  return { onCategory, names, showAll, searchHere, run, offerHere, results, highlight };
}
