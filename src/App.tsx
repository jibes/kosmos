import type * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { distance, type LngLat } from './core/geo';
import { parsePhoton, reverseUrl, searchUrl, type Place } from './core/search';
import { LABEL_LAYERS } from './core/style';
import { lang, t } from './i18n';
import { About } from './ui/About';
import { Controls } from './ui/Controls';
import { onLongPress } from './ui/gestures';
import { pinMarker, userMarker } from './ui/markers';
import { isNative } from './ui/native';
import { PlaceCard } from './ui/PlaceCard';
import { SearchBar } from './ui/SearchBar';
import { UpdateToast } from './ui/UpdateToast';
import { useLocation } from './ui/useLocation';
import { useMap } from './ui/useMap';
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
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clear]);

  return (
    <>
      <div ref={mapEl} className="map" />
      <main className="ui">
        <div className="panel">
          {selection && (
            <PlaceCard
              key={`${selection.place.lng},${selection.place.lat}`}
              place={selection.place}
              loading={selection.loading}
              onClose={clear}
              onToast={showToast}
            />
          )}
          <SearchBar
            lang={lang}
            bias={bias}
            onPick={pick}
            collapsed={!!selection}
            onFocus={clear}
          />
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
