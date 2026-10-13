import type * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { distance, type LngLat } from './core/geo';
import { parsePhoton, reverseUrl, searchUrl, type Place } from './core/search';
import type { Mode } from './core/route';
import { LABEL_LAYERS, ROUTE_ALT_LAYER, ROUTE_SOURCE } from './core/style';
import { lang, t } from './i18n';
import { About } from './ui/About';
import { Controls } from './ui/Controls';
import { onLongPress } from './ui/gestures';
import { pinMarker, startMarker, userMarker } from './ui/markers';
import { isNative } from './ui/native';
import { PlaceCard } from './ui/PlaceCard';
import { RouteCard } from './ui/RouteCard';
import { SearchBar } from './ui/SearchBar';
import { UpdateToast } from './ui/UpdateToast';
import { useLocation } from './ui/useLocation';
import { useMap } from './ui/useMap';
import { useRoute, type Trip } from './ui/useRoute';
import { useTheme } from './ui/useTheme';

/** Map labels follow the browser language even where the UI falls back to English. */
const LABEL_LANG = (typeof navigator === 'undefined' ? 'en' : navigator.language)
  .split('-')[0]
  .toLowerCase();

interface Selection {
  place: Place;
  loading: boolean;
}

const wide = () => matchMedia('(min-width: 900px)').matches;
/** Keeps a selected place clear of the panel that describes it. */
const padding = () =>
  wide()
    ? { top: 48, bottom: 48, left: 440, right: 48 }
    : { top: 96, bottom: 300, left: 32, right: 32 };
/** Routes leave room for the taller route card. */
const routePadding = () =>
  wide()
    ? { top: 64, bottom: 64, left: 460, right: 64 }
    : { top: 96, bottom: 380, left: 40, right: 40 };

async function fetchPlaces(url: string): Promise<Place[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return parsePhoton(await res.json());
}

export function App() {
  const theme = useTheme();
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useMap(mapEl, theme, LABEL_LANG);
  const { fix, status, start } = useLocation();
  const [following, setFollowing] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [about, setAbout] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [active, setActive] = useState(0);
  const [pickingStart, setPickingStart] = useState(false);
  const route = useRoute(trip, fix, lang);
  const tripRef = useRef(trip);
  useEffect(() => {
    tripRef.current = trip;
  }, [trip]);
  const pending = useRef(0);
  const flyOnFix = useRef(false);
  const lastHold = useRef(0);
  const followRef = useRef(following);
  useEffect(() => {
    followRef.current = following;
  }, [following]);

  const showToast = useCallback((msg: string) => setToast(msg), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  /** Shows a place at once, then fills in its details when the lookup returns. */
  const select = useCallback((place: Place, enrich?: () => Promise<Partial<Place> | null>) => {
    const token = ++pending.current;
    setSelection({ place, loading: !!enrich });
    enrich?.()
      .catch(() => null)
      .then((extra) => {
        if (token !== pending.current) return;
        setSelection({ place: { ...place, ...extra }, loading: false });
      });
  }, []);

  const clear = useCallback(() => {
    pending.current++;
    setSelection(null);
    setTrip(null);
    setPickingStart(false);
  }, []);

  const openRoute = useCallback(() => {
    if (!selection) return;
    start();
    setActive(0);
    setFollowing(false);
    setTrip({ to: selection.place, from: null, mode: 'car' });
  }, [selection, start]);

  const closeRoute = useCallback(() => {
    setTrip(null);
    setPickingStart(false);
  }, []);

  const setMode = useCallback((mode: Mode) => {
    setActive(0);
    setTrip((tr) => (tr ? { ...tr, mode } : tr));
  }, []);

  // Pin: the selected place.
  const pin = useRef<maplibregl.Marker | null>(null);
  const sel = selection?.place;
  useEffect(() => {
    if (!map) return;
    if (!sel) {
      pin.current?.remove();
      return;
    }
    pin.current ??= pinMarker();
    pin.current.setLngLat([sel.lng, sel.lat]).addTo(map);
  }, [map, sel?.lng, sel?.lat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Taps on labels select them; a long press drops a pin anywhere.
  useEffect(() => {
    if (!map) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (Date.now() - lastHold.current < 700) return;
      if (tripRef.current) {
        const { x, y } = e.point;
        const [alt] = map.queryRenderedFeatures(
          [
            [x - 8, y - 8],
            [x + 8, y + 8],
          ],
          { layers: [ROUTE_ALT_LAYER] },
        );
        if (alt) setActive(Number(alt.properties.index));
        return;
      }
      const layers = LABEL_LAYERS.filter((id) => map.getLayer(id));
      const { x, y } = e.point;
      const [f] = map.queryRenderedFeatures(
        [
          [x - 10, y - 10],
          [x + 10, y + 10],
        ],
        { layers },
      );
      const props = f?.properties ?? {};
      const name = (props[`name:${LABEL_LANG}`] ?? props.name) as string | undefined;
      if (!f || !name) {
        clear();
        return;
      }
      const at: LngLat =
        f.geometry.type === 'Point'
          ? { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }
          : e.lngLat;
      select({ name, detail: '', ...at }, async () => {
        const hits = await fetchPlaces(searchUrl(name, lang, { ...at, zoom: 14 }, 3));
        const hit = hits.find((p) => distance(p, at) < 30_000);
        return hit ? { detail: hit.detail } : null;
      });
    };
    const offHold = onLongPress(map, (at) => {
      if (tripRef.current) return;
      lastHold.current = Date.now();
      const here = { lng: at.lng, lat: at.lat };
      select({ name: t.droppedPin, detail: '', ...here }, async () => {
        const [hit] = await fetchPlaces(reverseUrl(here, lang));
        return hit ? { name: hit.name, detail: hit.detail } : null;
      });
    });
    const pointer = () => (map.getCanvas().style.cursor = 'pointer');
    const grab = () => (map.getCanvas().style.cursor = '');
    const layers = [...LABEL_LAYERS];
    map.on('click', onClick);
    map.on('mouseenter', layers, pointer);
    map.on('mouseleave', layers, grab);
    return () => {
      offHold();
      map.off('click', onClick);
      map.off('mouseenter', layers, pointer);
      map.off('mouseleave', layers, grab);
    };
  }, [map, select, clear]);

  const pick = useCallback(
    (place: Place) => {
      if (!map) return;
      if (tripRef.current) {
        setPickingStart(false);
        setActive(0);
        setTrip({ ...tripRef.current, from: place });
        return;
      }
      setFollowing(false);
      select(place);
      const [w, s, e, n] = place.bbox ?? [0, 0, 0, 0];
      if (place.bbox && (e - w > 0.002 || n - s > 0.002)) {
        map.fitBounds(place.bbox, { padding: padding(), maxZoom: 17, duration: 1600 });
      } else {
        const zoom = Math.max(map.getZoom(), 16);
        map.flyTo({ center: [place.lng, place.lat], zoom, padding: padding(), duration: 1600 });
      }
    },
    [map, select],
  );

  const bias = useCallback(() => {
    if (!map) return undefined;
    const c = map.getCenter().wrap();
    return { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
  }, [map]);

  // Location: the dot, and the camera while following.
  const me = useRef<ReturnType<typeof userMarker> | null>(null);
  useEffect(() => {
    if (!map) return;
    const m = userMarker(map);
    me.current = m;
    const stopFollowing = () => setFollowing(false);
    map.on('dragstart', stopFollowing);
    return () => {
      m.remove();
      map.off('dragstart', stopFollowing);
    };
  }, [map]);

  useEffect(() => {
    if (!map || !fix) return;
    me.current?.update(fix);
    if (flyOnFix.current) {
      flyOnFix.current = false;
      map.flyTo({ center: [fix.lng, fix.lat], zoom: Math.max(map.getZoom(), 15), duration: 1800 });
    } else if (followRef.current) {
      map.easeTo({ center: [fix.lng, fix.lat], duration: 800 });
    }
  }, [map, fix]);

  // Route: alternatives under the chosen one; refit only when the trip itself changes.
  const shown = route.routes;
  const chosen = Math.min(active, Math.max(0, shown.length - 1));
  useEffect(() => {
    const src = map?.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const order = shown.map((_, i) => i).sort((a, b) => (a === chosen ? 1 : b === chosen ? -1 : 0));
    src.setData({
      type: 'FeatureCollection',
      features: order.map((i) => ({
        type: 'Feature',
        properties: { index: i, alt: i !== chosen },
        geometry: { type: 'LineString', coordinates: shown[i].coords },
      })),
    });
  }, [map, shown, chosen]);

  const fitted = useRef('');
  useEffect(() => {
    if (!map || route.status !== 'ready' || fitted.current === route.key) return;
    fitted.current = route.key;
    const [w, s, e, n] = shown.reduce(
      (b, r) => [
        Math.min(b[0], r.bbox[0]),
        Math.min(b[1], r.bbox[1]),
        Math.max(b[2], r.bbox[2]),
        Math.max(b[3], r.bbox[3]),
      ],
      [180, 90, -180, -90],
    );
    map.fitBounds([w, s, e, n], { padding: routePadding(), maxZoom: 17, duration: 1200 });
  }, [map, route.status, route.key, shown]);
  useEffect(() => {
    if (!trip) fitted.current = '';
  }, [trip]);

  // A chosen start gets its own marker; "my location" already has the dot.
  const startPin = useRef<maplibregl.Marker | null>(null);
  const from = trip?.from;
  useEffect(() => {
    if (!map || !from) {
      startPin.current?.remove();
      return;
    }
    startPin.current ??= startMarker();
    startPin.current.setLngLat([from.lng, from.lat]).addTo(map);
  }, [map, from]);

  const locate = () => {
    if (status === 'denied') {
      showToast(t.locationDenied);
      return;
    }
    start();
    setFollowing(true);
    if (fix && map) {
      map.flyTo({ center: [fix.lng, fix.lat], zoom: Math.max(map.getZoom(), 15), duration: 1400 });
    } else {
      flyOnFix.current = true;
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target instanceof HTMLInputElement) return;
      if (tripRef.current) closeRoute();
      else clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clear, closeRoute]);

  return (
    <>
      <div ref={mapEl} className="map" />
      <main className="ui">
        <div className="panel">
          {trip && !pickingStart && (
            <RouteCard
              to={trip.to}
              from={trip.from}
              mode={trip.mode}
              routes={shown}
              active={chosen}
              status={route.status}
              lang={lang}
              onMode={setMode}
              onActive={setActive}
              onChangeStart={() => setPickingStart(true)}
              onUseMyLocation={() => {
                start();
                setTrip({ ...trip, from: null });
              }}
              onRetry={route.retry}
              onClose={closeRoute}
            />
          )}
          {selection && !trip && (
            <PlaceCard
              key={`${selection.place.lng},${selection.place.lat}`}
              place={selection.place}
              loading={selection.loading}
              onClose={clear}
              onToast={showToast}
              onRoute={openRoute}
            />
          )}
          {(!trip || pickingStart) && (
            <SearchBar
              key={pickingStart ? 'start' : 'place'}
              lang={lang}
              bias={bias}
              onPick={pick}
              collapsed={!!selection && !pickingStart}
              onFocus={pickingStart ? () => undefined : clear}
              placeholder={pickingStart ? t.searchStart : undefined}
              autoFocus={pickingStart}
            />
          )}
        </div>
        <Controls map={map} status={status} following={following} onLocate={locate} />
        <button type="button" className="credit" onClick={() => setAbout(true)}>
          © OpenStreetMap
        </button>
      </main>
      {about && <About onClose={() => setAbout(false)} />}
      {toast && (
        <div className="toast surface" role="status">
          {toast}
        </div>
      )}
      {!isNative && <UpdateToast />}
    </>
  );
}
