import { motion } from './motion';
import type * as maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { Route } from '../core/route';
import type { Place } from '../core/search';
import { ROUTE_SOURCE } from '../core/style';
import { startMarker } from './markers';

const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

/** One route as map features: a road route is one line; public transport draws each ride in
 * its line colour, the walks dotted, and marks the stops where you get on and off. */
function routeFeatures(routes: Route[], i: number, chosen: number): GeoJSON.Feature[] {
  const r = routes[i];
  const alt = i !== chosen;
  if (alt || !r.transit) {
    return [
      {
        type: 'Feature',
        properties: { index: i, alt },
        geometry: { type: 'LineString', coordinates: r.coords },
      },
    ];
  }
  return [
    ...r.transit.legs.map((l): GeoJSON.Feature => ({
      type: 'Feature',
      properties: { index: i, alt, walk: !l.ride, ...(l.color ? { color: l.color } : {}) },
      geometry: { type: 'LineString', coordinates: l.coords },
    })),
    ...r.transit.legs
      .filter((l) => l.ride)
      .flatMap((l) => [l.from, l.to])
      .map((p): GeoJSON.Feature => ({
        type: 'Feature',
        properties: { index: i, alt, stop: true },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
  ];
}

interface Options {
  routes: Route[];
  chosen: number;
  navigating: boolean;
  /** Routes for the current trip have arrived. */
  ready: boolean;
  /** Changes with the trip; the map refits once per value. */
  tripKey: string;
  /** A chosen start gets its own marker; "my location" already has the dot. */
  from: Place | null;
  hasTrip: boolean;
  /** The map area the route card leaves free, measured when fitting. */
  padding: () => maplibregl.PaddingOptions;
}

/** Draws the routes (alternatives under the chosen one), fits them once per trip, and marks a
 * start that is not the user's location. */
export function useRouteLayer(map: maplibregl.Map | null, o: Options) {
  const { routes, chosen, navigating, ready, tripKey, from, hasTrip, padding } = o;

  useEffect(() => {
    const src = map?.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    // While navigating only the route being followed shows.
    const order = navigating
      ? routes.length
        ? [chosen]
        : []
      : routes.map((_, i) => i).sort((a, b) => (a === chosen ? 1 : b === chosen ? -1 : 0));
    src.setData({
      type: 'FeatureCollection',
      features: order.flatMap((i) => routeFeatures(routes, i, chosen)),
    });
  }, [map, routes, chosen, navigating]);

  const fitted = useRef('');
  useEffect(() => {
    if (!map || navigating || !ready || fitted.current === tripKey) return;
    fitted.current = tripKey;
    const [w, s, e, n] = routes.reduce(
      (b, r) => [
        Math.min(b[0], r.bbox[0]),
        Math.min(b[1], r.bbox[1]),
        Math.max(b[2], r.bbox[2]),
        Math.max(b[3], r.bbox[3]),
      ],
      [180, 90, -180, -90],
    );
    // MapLibre adds the camera's standing padding (left by an earlier flyTo or by navigation) to
    // the fit's own; together they can exceed the screen and the fit is silently dropped.
    map.stop();
    map.setPadding(NO_PADDING);
    // Flat and north up: guidance may have just ended, tilted and turned (its own ease is stopped).
    map.fitBounds([w, s, e, n], {
      padding: padding(),
      pitch: 0,
      bearing: 0,
      maxZoom: 17,
      duration: motion(1200),
    });
  }, [map, navigating, ready, tripKey, routes, padding]);
  useEffect(() => {
    if (!hasTrip) fitted.current = '';
  }, [hasTrip]);

  const startPin = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    if (!map || !from) {
      startPin.current?.remove();
      return;
    }
    startPin.current ??= startMarker();
    startPin.current.setLngLat([from.lng, from.lat]).addTo(map);
  }, [map, from]);
}
