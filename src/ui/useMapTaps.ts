import type * as maplibregl from 'maplibre-gl';
import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { LngLat } from '../core/geo';
import {
  nearestWithin,
  parseAddress,
  parsePhoton,
  reverseUrl,
  searchUrl,
  type Place,
} from '../core/search';
import { isStopPoi } from '../core/departures';
import { LABEL_LAYERS, POI_LAYERS, ROUTE_ALT_LAYER } from '../core/style';
import { lang, t } from '../i18n';
import { onLongPress } from './gestures';
import { logEvent } from './usageLog';
import { searchResultAt } from './useCategory';
import type { StopAdder } from './useStops';
import { motion } from './motion';
import type { Trip } from './useRoute';
import { favouriteAt, placeOf } from './useFavourites';
import { contactAt, placeOfContact } from './useContacts';

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** A place card's lookup: what to add to the place once it answers. */
export type Enrich = () => Promise<Partial<Place> | null>;

/** How far a label's place may lie from where its label stands, by kind of label. */
const RADIUS_M: Record<string, number> = {
  ...Object.fromEntries(POI_LAYERS.map((id) => [id, 150])),
  'search-names': 150,
  'search-dots': 150,
  'label-peak': 1000,
  'label-water': 5000,
  'label-water-line': 5000,
};
/** Towns and districts: their label stands anywhere in them. */
const PLACE_RADIUS_M = 30_000;

/**
 * The address line (and OSM id, for hours and contacts) of a place known by name and position:
 * a map label or a category result. Only the nearest same-named place close enough counts;
 * otherwise the address of the spot itself and no id, never another branch's hours.
 */
export async function addressOf(
  name: string,
  at: LngLat,
  radius = RADIUS_M['label-poi'],
): Promise<Partial<Place> | null> {
  // A nameless place (a toilet, a cash machine) has nothing to search by but its spot.
  const hits = name
    ? parsePhoton(await fetchJson(searchUrl(name, lang, { ...at, zoom: 14 }, 5)))
    : [];
  const hit = nearestWithin(hits, at, radius);
  if (hit) return { detail: hit.detail, ...(hit.osm ? { osm: hit.osm } : {}) };
  const detail = parseAddress(await fetchJson(reverseUrl(at, lang)));
  return detail ? { detail } : null;
}

/** What is at a dropped pin: the nearest object's name and address, by reverse lookup. */
export async function spotOf(at: LngLat): Promise<Partial<Place>> {
  const [hit] = parsePhoton(await fetchJson(reverseUrl(at, lang)));
  return hit
    ? { name: hit.name, detail: hit.detail, ...(hit.osm ? { osm: hit.osm } : {}) }
    : { detail: t.noAddress };
}

interface Options {
  /** Map labels' language: a label's name is looked up as shown. */
  labelLang: string;
  select: (place: Place, enrich?: Enrich) => void;
  clear: () => void;
  showToast: (text: string, actions?: { label: string; run: () => void }[]) => void;
  tripRef: RefObject<Trip | null>;
  navRef: RefObject<boolean>;
  setActive: (index: number) => void;
  setTrip: Dispatch<SetStateAction<Trip | null>>;
  /** A place as a stop on the way of the open route (`useStops`). */
  addStopRef: RefObject<StopAdder>;
}

/** Zooms to where a group of marks comes apart, centred on it. */
function zoomIntoGroup(map: maplibregl.Map, f: maplibregl.MapGeoJSONFeature) {
  const src = map.getSource(f.source) as maplibregl.GeoJSONSource | undefined;
  const id = Number(f.properties.cluster_id);
  const center = (f.geometry as GeoJSON.Point).coordinates as [number, number];
  void src
    ?.getClusterExpansionZoom(id)
    .then((zoom) => map.easeTo({ center, zoom: zoom + 0.2, duration: motion(500) }))
    .catch(() => undefined);
}

/**
 * The map's own taps: a label selects its place, a long press (right-click) drops a pin, or,
 * with a route open, makes the spot its start or destination; a click on another route
 * chooses it. The pointer says which of these a click would do.
 */
export function useMapTaps(map: maplibregl.Map | null, o: Options) {
  const opts = useRef(o);
  useEffect(() => {
    opts.current = o;
  });

  useEffect(() => {
    if (!map) return;
    const { tripRef, navRef } = opts.current;
    let lastHold = 0;
    /** With a road route open, also while guiding: a label tapped can be a stop on the way. */
    const offerStop = (x: number, y: number) => {
      const { showToast, addStopRef, labelLang } = opts.current;
      const tr = tripRef.current;
      if (!tr) return;
      // Guiding, the stops reached count no more (`useStops`).
      const canStop = addStopRef.current.can;
      // A ride is guided by its timetable: its end changes on the route card, not on the way.
      const canEnd = !(navRef.current && tr.mode === 'transit');
      if (!canStop && !canEnd) return;
      const layers = LABEL_LAYERS.filter((id) => map.getLayer(id));
      const [f] = map.queryRenderedFeatures(
        [
          [x - 10, y - 10],
          [x + 10, y + 10],
        ],
        { layers },
      );
      if (f?.layer.id.endsWith('-groups')) return zoomIntoGroup(map, f);
      const p = f?.properties ?? {};
      const fav = f?.layer.id.startsWith('fav-') ? favouriteAt(Number(p.fav)) : undefined;
      const contact = f?.layer.id.startsWith('contact-') ? contactAt(Number(p.contact)) : undefined;
      const name = (p[`name:${labelLang}`] ?? p.name) as string | undefined;
      const place: Place | null = fav
        ? placeOf(fav)
        : contact
          ? placeOfContact(contact)
          : f && name && f.geometry.type === 'Point'
            ? {
                name,
                detail: '',
                lng: f.geometry.coordinates[0],
                lat: f.geometry.coordinates[1],
                ...((POI_LAYERS.includes(f.layer.id) && isStopPoi(p)) || p.stop === true
                  ? { stop: true }
                  : {}),
              }
            : null;
      if (!place) return;
      // A label's address and id, as a tap without a route looks them up: for its card.
      const label = !fav && !contact && f;
      const enrich = label
        ? () => addressOf(place.name, place, RADIUS_M[label.layer.id] ?? PLACE_RADIUS_M)
        : undefined;
      const { setTrip, select, setActive } = opts.current;
      const goHere = () => {
        logEvent('route.end', { navigating: navRef.current });
        setActive(0);
        setTrip((now) => (now ? { ...now, to: place } : now));
        // A new destination is the selected place too: its pin and, on closing, its card.
        if (!navRef.current) select(place, enrich);
      };
      showToast(place.name, [
        ...(canStop ? [{ label: t.addStop, run: () => addStopRef.current.add(place) }] : []),
        ...(canEnd ? [{ label: t.goHere, run: goHere }] : []),
      ]);
    };
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const { select, clear, setActive, labelLang } = opts.current;
      if (Date.now() - lastHold < 700) return;
      const { x, y } = e.point;
      if (tripRef.current) {
        const [alt] = map.queryRenderedFeatures(
          [
            [x - 8, y - 8],
            [x + 8, y + 8],
          ],
          { layers: [ROUTE_ALT_LAYER] },
        );
        if (alt) setActive(Number(alt.properties.index));
        else offerStop(x, y);
        return;
      }
      const layers = LABEL_LAYERS.filter((id) => map.getLayer(id));
      const [f] = map.queryRenderedFeatures(
        [
          [x - 10, y - 10],
          [x + 10, y + 10],
        ],
        { layers },
      );
      const props = f?.properties ?? {};
      // A group of marks too close to tell apart: in until they part.
      if (f?.layer.id.endsWith('-groups') && f.geometry.type === 'Point') {
        zoomIntoGroup(map, f);
        return;
      }
      // A star: the place as it was kept, its card at once (details by its OSM id).
      const fav = f?.layer.id.startsWith('fav-') ? favouriteAt(Number(props.fav)) : undefined;
      if (fav) {
        select(placeOf(fav));
        return;
      }
      const contact = f?.layer.id.startsWith('contact-')
        ? contactAt(Number(props.contact))
        : undefined;
      if (contact) {
        select(placeOfContact(contact));
        return;
      }
      // A search result's dot: that result, as its row would open it, not a fresh lookup.
      const found = f?.layer.id.startsWith('search-') ? searchResultAt(Number(f.id)) : undefined;
      if (found) {
        select(
          found,
          found.distance === undefined || found.detail
            ? undefined
            : () => addressOf(found.unnamed ? '' : found.name, found),
        );
        return;
      }
      const name = (props[`name:${labelLang}`] ?? props.name) as string | undefined;
      if (!f || !name) {
        clear();
        return;
      }
      const at: LngLat =
        f.geometry.type === 'Point'
          ? { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }
          : e.lngLat;
      const radius = RADIUS_M[f.layer.id] ?? PLACE_RADIUS_M;
      // A stop's label, or the dot of a stop a search found.
      const stop = (POI_LAYERS.includes(f.layer.id) && isStopPoi(props)) || props.stop === true;
      select({ name, detail: '', ...at, ...(stop ? { stop } : {}) }, () =>
        addressOf(name, at, radius),
      );
    };
    const offHold = onLongPress(map, (at) => {
      const { select, showToast, setActive, setTrip } = opts.current;
      // While guiding, the trip is settled: a start or destination changed now would send the
      // reroutes from the wrong place.
      if (navRef.current) return;
      lastHold = Date.now();
      const here = { lng: at.lng, lat: at.lat };
      const pin: Place = { name: t.droppedPin, detail: '', ...here };
      // With a route open, a point on the map becomes its start or its destination.
      if (tripRef.current) {
        const set = (end: 'from' | 'to') => {
          setActive(0);
          setTrip((tr) => (tr ? { ...tr, [end]: pin } : tr));
          const found = spotOf(here).catch(() => null);
          // A new destination is the selected place too: its pin and, on closing, its card.
          if (end === 'to') select(pin, () => found);
          void found.then((extra) =>
            setTrip((tr) => (tr && tr[end] === pin ? { ...tr, [end]: { ...pin, ...extra } } : tr)),
          );
        };
        const { addStopRef } = opts.current;
        // A stop held on the map takes its address too, as a start or destination does.
        const addPin = () => {
          addStopRef.current.add(pin);
          void spotOf(here)
            .catch(() => null)
            .then((extra) =>
              setTrip((tr) =>
                tr?.via?.includes(pin)
                  ? { ...tr, via: tr.via.map((v) => (v === pin ? { ...pin, ...extra } : v)) }
                  : tr,
              ),
            );
        };
        const stop = addStopRef.current.can ? [{ label: t.addStop, run: addPin }] : [];
        showToast(t.droppedPin, [
          { label: t.startHere, run: () => set('from') },
          ...stop,
          { label: t.goHere, run: () => set('to') },
        ]);
        return;
      }
      select(pin, () => spotOf(here));
    });
    // The pointer shows what a click does: a label without a route open, an alternative with one.
    const pointer = (alt: boolean) => () => {
      if (!!tripRef.current === alt) map.getCanvas().style.cursor = 'pointer';
    };
    const [onLabel, onAlt] = [pointer(false), pointer(true)];
    const grab = () => (map.getCanvas().style.cursor = '');
    const layers = [...LABEL_LAYERS];
    map.on('click', onClick);
    map.on('mouseenter', layers, onLabel);
    map.on('mouseleave', layers, grab);
    map.on('mouseenter', ROUTE_ALT_LAYER, onAlt);
    map.on('mouseleave', ROUTE_ALT_LAYER, grab);
    return () => {
      offHold();
      map.off('click', onClick);
      map.off('mouseenter', layers, onLabel).off('mouseleave', layers, grab);
      map.off('mouseenter', ROUTE_ALT_LAYER, onAlt).off('mouseleave', ROUTE_ALT_LAYER, grab);
    };
  }, [map]);
}
