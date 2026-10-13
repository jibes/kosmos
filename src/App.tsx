import type * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { distance, type LngLat } from './core/geo';
import { parsePhoton, reverseUrl, searchUrl, type Place } from './core/search';
import { COMPASS_BELOW_MS, travelHeading } from './core/compass';
import { navZoom, offRouteLimit, type NavState } from './core/nav';
import type { Mode, Route, TravelMode } from './core/route';
import { LABEL_LAYERS, ROUTE_ALT_LAYER, ROUTE_SOURCE } from './core/style';
import { lang, t } from './i18n';
import { About } from './ui/About';
import { Controls, type Follow } from './ui/Controls';
import { onLongPress } from './ui/gestures';
import { pinMarker, startMarker, userMarker } from './ui/markers';
import { isNative } from './ui/native';
import { NavView } from './ui/NavView';
import { PlaceCard } from './ui/PlaceCard';
import { RouteCard } from './ui/RouteCard';
import { SearchBar } from './ui/SearchBar';
import { UpdateToast } from './ui/UpdateToast';
import { useLocation } from './ui/useLocation';
import { useCompass } from './ui/useCompass';
import { useMap } from './ui/useMap';
import { useNav } from './ui/useNav';
import { useRoute, type Trip } from './ui/useRoute';
import { useNavTheme } from './ui/useNavTheme';
import { useTheme } from './ui/useTheme';
import { systemVoice } from './ui/voice';
import { keepAwake } from './ui/wakeLock';

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
/** While navigating, the user sits low on screen so more of the road ahead shows. */
const navPadding = () =>
  wide()
    ? { top: 260, bottom: 60, left: 0, right: 0 }
    : { top: Math.round(innerHeight * 0.42), bottom: 110, left: 0, right: 0 };

const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

const MUTED_KEY = 'kosmos.muted.v1';
const storedMuted = () => {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
};

/** Fits a route into the map area the route card leaves free, measured, not guessed. */
const routePadding = () => {
  const panel = document.querySelector('.panel')?.getBoundingClientRect();
  if (wide()) return { top: 64, bottom: 64, left: (panel?.right ?? 420) + 48, right: 96 };
  const bottom = panel && panel.height ? innerHeight - panel.top + 24 : 380;
  return { top: 96, bottom: Math.min(bottom, innerHeight - 220), left: 40, right: 80 };
};

async function fetchPlaces(url: string): Promise<Place[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return parsePhoton(await res.json());
}

export function App() {
  const systemTheme = useTheme();
  const [navigating, setNavigating] = useState(false);
  const { dark: navDark, update: updateNavTheme } = useNavTheme(navigating);
  const theme = navDark ? 'dark' : systemTheme;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useMap(mapEl, theme, LABEL_LANG);
  const { fix, status, start, subscribe, background } = useLocation();
  /** Off, follow the position north-up, or follow and turn the map with the compass. */
  const [follow, setFollow] = useState<Follow>('off');
  const compass = useCompass();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [about, setAbout] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [active, setActive] = useState(0);
  /** Which end of the route the search bar is choosing, if any. */
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const pickingRef = useRef(picking);
  useEffect(() => {
    pickingRef.current = picking;
  }, [picking]);
  const [navFollow, setNavFollow] = useState(true);
  const [muted, setMuted] = useState(storedMuted);
  const [rerouteFrom, setRerouteFrom] = useState<Route | null>(null);
  const route = useRoute(trip, fix, lang, navigating);
  const voice = useMemo(() => systemVoice(navigator.language || lang), []);
  const navRef = useRef(false);
  const navFollowRef = useRef(true);
  useEffect(() => {
    navRef.current = navigating;
    navFollowRef.current = navFollow;
  }, [navigating, navFollow]);
  const tripRef = useRef(trip);
  useEffect(() => {
    tripRef.current = trip;
  }, [trip]);
  const pending = useRef(0);
  const flyOnFix = useRef(false);
  const lastHold = useRef(0);
  const followRef = useRef(follow);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

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
    setPicking(null);
  }, []);

  const openRoute = useCallback(() => {
    if (!selection) return;
    start();
    setActive(0);
    setFollow('off');
    setTrip({ to: selection.place, from: null, mode: 'car' });
  }, [selection, start]);

  const closeRoute = useCallback(() => {
    setNavigating(false);
    setTrip(null);
    setPicking(null);
  }, []);

  const setMode = useCallback((mode: TravelMode) => {
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
        const end = pickingRef.current;
        setPicking(null);
        setActive(0);
        if (end === 'end') {
          setTrip({ ...tripRef.current, to: place });
          select(place);
        } else {
          setTrip({ ...tripRef.current, from: place });
        }
        return;
      }
      setFollow('off');
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
    const stopFollowing = () => {
      setFollow('off');
      if (navRef.current) setNavFollow(false);
    };
    map.on('dragstart', stopFollowing);
    return () => {
      m.remove();
      map.off('dragstart', stopFollowing);
    };
  }, [map]);

  useEffect(() => {
    if (!map || !fix || navRef.current) return;
    me.current?.update(fix);
    if (flyOnFix.current) {
      flyOnFix.current = false;
      map.flyTo({ center: [fix.lng, fix.lat], zoom: Math.max(map.getZoom(), 15), duration: 1800 });
    } else if (followRef.current === 'position') {
      // Never cut short the fly-in after tapping locate: easing only the centre would stop it
      // at globe zoom. The next fix catches up.
      if (!map.isMoving()) map.easeTo({ center: [fix.lng, fix.lat], duration: 800 });
    } else if (followRef.current === 'compass') {
      // The compass turns the map every frame; an ease here would fight it, so the centre jumps.
      if (!map.isMoving()) map.jumpTo({ center: [fix.lng, fix.lat] });
    }
  }, [map, fix, compass]);

  // Compass: the beam on the dot always; in compass mode the map turns with the phone.
  const lastNavSpeed = useRef(0);
  useEffect(() => {
    if (!map) return;
    let frame = 0;
    let latest = 0;
    const off = compass.subscribe((h) => {
      latest = h;
      if (navRef.current) {
        // Slow or standing: GPS course is noise, so the arrow shows where the phone faces.
        if (lastNavSpeed.current < COMPASS_BELOW_MS) me.current?.heading(h);
        return;
      }
      me.current?.facing(h);
      if (followRef.current !== 'compass' || frame) return;
      const turn = () => {
        if (followRef.current !== 'compass') {
          frame = 0;
          return;
        }
        // Another camera move (e.g. the fly-in after tapping locate) runs: try again next frame.
        if (map.isMoving()) {
          frame = requestAnimationFrame(turn);
          return;
        }
        frame = 0;
        map.setBearing(latest);
      };
      frame = requestAnimationFrame(turn);
    });
    // Turning the map by hand leaves compass mode but keeps following the position.
    const onRotate = (e: { originalEvent?: Event }) => {
      if (e.originalEvent && followRef.current === 'compass') setFollow('position');
    };
    map.on('rotatestart', onRotate);
    return () => {
      off();
      cancelAnimationFrame(frame);
      map.off('rotatestart', onRotate);
    };
  }, [map, compass]);

  // Route: alternatives under the chosen one; refit only when the trip itself changes.
  const shown = route.routes;
  const chosen = Math.min(active, Math.max(0, shown.length - 1));
  /** A public transport route draws each ride in its line colour, the walks dashed. */
  const routeFeatures = useCallback(
    (i: number): GeoJSON.Feature[] => {
      const r = shown[i];
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
    },
    [shown, chosen],
  );
  useEffect(() => {
    const src = map?.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const order = navigating
      ? shown.length
        ? [chosen]
        : []
      : shown.map((_, i) => i).sort((a, b) => (a === chosen ? 1 : b === chosen ? -1 : 0));
    src.setData({ type: 'FeatureCollection', features: order.flatMap((i) => routeFeatures(i)) });
  }, [map, shown, chosen, navigating, routeFeatures]);

  const fitted = useRef('');
  useEffect(() => {
    if (!map || navigating || route.status !== 'ready' || fitted.current === route.key) return;
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
    // MapLibre adds the camera's standing padding (left by an earlier flyTo or by navigation) to
    // the fit's own; together they can exceed the screen and the fit is silently dropped.
    map.stop();
    map.setPadding(NO_PADDING);
    map.fitBounds([w, s, e, n], { padding: routePadding(), maxZoom: 17, duration: 1200 });
  }, [map, navigating, route.status, route.key, shown]);
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

  // Navigation: guidance on the device, camera behind the user, the router asked only to reroute.
  const lastSnap = useRef<NavState['snap']>(null);
  const followCamera = useCallback(
    (nav: NavState, duration: number) => {
      if (!map || !nav.snap) return;
      map.easeTo({
        center: nav.snap.point,
        bearing: travelHeading(nav.snap.bearing, compass.current(), nav.speed) ?? nav.snap.bearing,
        pitch: 55,
        zoom: navZoom(nav.speed),
        padding: navPadding(),
        duration,
        easing: (x) => x,
      });
    },
    [map, compass],
  );
  const onStep = useCallback(
    (nav: NavState, f: { lng: number; lat: number; accuracy: number }) => {
      const s = nav.snap;
      const onLine = s && s.offset < offRouteLimit(f.accuracy);
      me.current?.update(onLine ? { lng: s.point[0], lat: s.point[1], accuracy: f.accuracy } : f);
      lastNavSpeed.current = nav.speed;
      me.current?.heading(s ? travelHeading(s.bearing, compass.current(), nav.speed) : null);
      lastSnap.current = s;
      if (s && map) updateNavTheme(map, s, nav.time);
      if (navFollowRef.current) followCamera(nav, 1000);
    },
    [followCamera, compass, map, updateNavTheme],
  );
  const reroute = useCallback(() => {
    setRerouteFrom(route.routes[chosen] ?? null);
    setActive(0);
    route.retry();
  }, [route, chosen]);
  /** Public transport has no turn-by-turn yet, so guidance only ever sees a road mode. */
  const roadMode: Mode = trip && trip.mode !== 'transit' ? trip.mode : 'car';
  const { nav } = useNav({
    route: navigating ? shown[chosen] : undefined,
    mode: roadMode,
    active: navigating,
    subscribe,
    voice,
    muted,
    onStep,
    onReroute: reroute,
  });

  const startNav = () => {
    if (!trip) return;
    start();
    void compass.start();
    if (trip.from) setTrip({ ...trip, from: null });
    setNavigating(true);
    setNavFollow(true);
    if (!isNative) showToast(t.keepOpen);
    map?.easeTo({ pitch: 55, zoom: Math.max(map.getZoom(), 16), duration: 800 });
  };
  const endNav = useCallback(() => {
    setNavigating(false);
    setRerouteFrom(null);
    voice.stop();
    me.current?.heading(null);
    map?.easeTo({ pitch: 0, bearing: 0, padding: NO_PADDING, duration: 800 });
  }, [map, voice]);
  const toggleMute = () => {
    setMuted((v) => {
      try {
        localStorage.setItem(MUTED_KEY, v ? '0' : '1');
      } catch {
        // Not remembered; still toggles for this session.
      }
      if (!v) voice.stop();
      return !v;
    });
  };
  useEffect(() => {
    if (!navigating) return;
    background(true);
    const release = keepAwake();
    return () => {
      release();
      background(false);
    };
  }, [navigating, background]);

  const locate = () => {
    if (status === 'denied') {
      showToast(t.locationDenied);
      return;
    }
    start();
    void compass.start();
    if (follow === 'position') {
      // Second tap: let the map turn with the phone, like a held paper map.
      if (compass.available) setFollow('compass');
      else showToast(t.noCompass);
      return;
    }
    if (follow === 'compass') {
      setFollow('position');
      map?.easeTo({ bearing: 0, duration: 500 });
      return;
    }
    setFollow('position');
    if (fix && map) {
      map.flyTo({ center: [fix.lng, fix.lat], zoom: Math.max(map.getZoom(), 15), duration: 1400 });
    } else {
      flyOnFix.current = true;
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target instanceof HTMLInputElement) return;
      if (navRef.current) endNav();
      else if (tripRef.current) closeRoute();
      else clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clear, closeRoute, endNav]);

  return (
    <>
      <div ref={mapEl} className="map" />
      <main className="ui" data-nav={navigating || undefined}>
        {navigating && shown[chosen] && (
          <NavView
            route={shown[chosen]}
            mode={roadMode}
            nav={nav}
            lang={lang}
            muted={muted}
            following={navFollow}
            rerouting={rerouteFrom !== null && rerouteFrom === shown[chosen]}
            onMute={toggleMute}
            onRecenter={() => {
              setNavFollow(true);
              followCamera({ ...nav, snap: lastSnap.current }, 600);
            }}
            onEnd={endNav}
          />
        )}
        <div className="panel" hidden={navigating}>
          {trip && !picking && (
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
              onChangeStart={() => setPicking('start')}
              onChangeEnd={() => setPicking('end')}
              onUseMyLocation={() => {
                start();
                setTrip({ ...trip, from: null });
              }}
              onRetry={route.retry}
              onClose={closeRoute}
              onStart={trip.mode === 'transit' ? undefined : startNav}
              at={trip.at ?? null}
              onDepart={(at) => {
                setActive(0);
                setTrip({ ...trip, at });
              }}
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
          {(!trip || picking) && (
            <SearchBar
              key={picking ?? 'place'}
              lang={lang}
              bias={bias}
              onPick={pick}
              collapsed={!!selection && !picking}
              onFocus={picking ? () => undefined : clear}
              placeholder={
                picking === 'start' ? t.searchStart : picking === 'end' ? t.searchEnd : undefined
              }
              autoFocus={!!picking}
              onCancel={picking ? () => setPicking(null) : undefined}
            />
          )}
        </div>
        {!navigating && (
          <Controls
            map={map}
            status={status}
            follow={follow}
            onLocate={locate}
            onNorth={() => {
              if (follow === 'compass') setFollow('position');
              map?.easeTo({ bearing: 0, pitch: 0, duration: 500 });
            }}
          />
        )}
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
