import type * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { distance, type LngLat } from './core/geo';
import { parsePhoton, reverseUrl, searchUrl, type Place } from './core/search';
import type { Mode, TravelMode } from './core/route';
import { LABEL_LAYERS, ROUTE_ALT_LAYER } from './core/style';
import { lang, locale, t } from './i18n';
import { About } from './ui/About';
import { Controls, type Follow } from './ui/Controls';
import { onLongPress } from './ui/gestures';
import { pinMarker, userMarker } from './ui/markers';
import { isNative, openAppSettings } from './ui/native';
import { NavView, NavWaiting } from './ui/NavView';
import { PlaceCard } from './ui/PlaceCard';
import { RideView, rideWords } from './ui/RideView';
import { RouteCard } from './ui/RouteCard';
import { SearchBar } from './ui/SearchBar';
import { Toasts, useToast } from './ui/Toasts';
import { useLocation } from './ui/useLocation';
import { useCompass } from './ui/useCompass';
import { useMap } from './ui/useMap';
import { useCategory } from './ui/useCategory';
import { useRide } from './ui/useRide';
import { useRoute, type Trip } from './ui/useRoute';
import { useGuidance } from './ui/useGuidance';
import { FRESH_MS } from './ui/useNav';
import { useRouteLayer } from './ui/useRouteLayer';
import { motion } from './ui/motion';
import { NO_PADDING, followNav, padding, routePadding, startBearing, touch } from './ui/layout';
import { HINTED_KEY, MODE_KEY, store, stored, storedMode } from './ui/prefs';
import { useAutoLocate, usePanel } from './ui/usePanel';
import { useBack } from './ui/useBack';
import { useNavTheme, useStatusBar } from './ui/useNavTheme';
import { useOffline } from './ui/useOffline';
import { useTheme } from './ui/useTheme';
import { systemVoice, useMuted } from './ui/voice';
import { keepAwake } from './ui/wakeLock';

/** Map labels follow the browser language even where the UI falls back to English. */
const LABEL_LANG = (typeof navigator === 'undefined' ? 'en' : navigator.language)
  .split('-')[0]
  .toLowerCase();

interface Selection {
  place: Place;
  loading: boolean;
}

/** After arriving, guidance (screen on, background location) ends by itself. */
const ARRIVED_END_MS = 60_000;
/** A second back press within this ends navigation. */
const BACK_TWICE_MS = 3000;

async function fetchPlaces(url: string): Promise<Place[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return parsePhoton(await res.json());
}

/** The address line for a place known only by name and position (a map label or POI). */
async function addressOf(name: string, at: LngLat) {
  const hits = await fetchPlaces(searchUrl(name, lang, { ...at, zoom: 14 }, 3));
  const hit = hits.find((p) => distance(p, at) < 30_000);
  return hit ? { detail: hit.detail, ...(hit.osm ? { osm: hit.osm } : {}) } : null;
}

export function App() {
  const systemTheme = useTheme();
  const [navigating, setNavigating] = useState(false);
  const {
    theme: navTheme,
    update: updateNavTheme,
    updateNight: updateRideTheme,
  } = useNavTheme(navigating);
  const theme = navTheme ?? systemTheme;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useStatusBar(navTheme);
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useMap(mapEl, theme, LABEL_LANG);
  const { fix, status, start, subscribe, background } = useLocation();
  /** Off, follow the position north-up, or follow and turn the map with the compass. */
  const [follow, setFollow] = useState<Follow>('off');
  const compass = useCompass();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [about, setAbout] = useState(false);
  const { toast, showToast, dismiss } = useToast();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [active, setActive] = useState(0);
  /** Which end of the route the search bar is choosing, if any. */
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const pickingRef = useRef(picking);
  useEffect(() => {
    pickingRef.current = picking;
  }, [picking]);
  const [navFollow, setNavFollow] = useState(true);
  const route = useRoute(trip, fix, lang, navigating);
  // The voice speaks the language of the words it is given: the UI's (and the router's).
  const voice = useMemo(() => systemVoice(locale), []);
  const { muted, begin: beginVoice, toggle: toggleMute } = useMuted(voice);
  const navRef = useRef(false);
  /** Road navigation owns the camera and the arrow; public transport only follows the dot. */
  const riding = navigating && trip?.mode === 'transit';
  const roadNavRef = useRef(false);
  /** Road guidance has its route and drives the arrow and the camera itself. */
  const trackingRef = useRef(false);
  const navFollowRef = useRef(true);
  useEffect(() => {
    navRef.current = navigating;
    roadNavRef.current = navigating && !riding;
    navFollowRef.current = navFollow;
  }, [navigating, navFollow, riding]);
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
    setTrip({ to: selection.place, from: null, mode: storedMode() });
  }, [selection, start]);

  const closeRoute = useCallback(() => {
    setNavigating(false);
    setTrip(null);
    setPicking(null);
  }, []);

  const setMode = useCallback((mode: TravelMode) => {
    setActive(0);
    store(MODE_KEY, mode);
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
      select({ name, detail: '', ...at }, () => addressOf(name, at));
    };
    const offHold = onLongPress(map, (at) => {
      // While guiding, the trip is settled: a start or destination changed now would send the
      // reroutes from the wrong place.
      if (navRef.current) return;
      lastHold.current = Date.now();
      const here = { lng: at.lng, lat: at.lat };
      const lookup = async (): Promise<Partial<Place>> => {
        const [hit] = await fetchPlaces(reverseUrl(here, lang));
        return hit
          ? { name: hit.name, detail: hit.detail, ...(hit.osm ? { osm: hit.osm } : {}) }
          : { detail: t.noAddress };
      };
      // With a route open, a point on the map becomes its start or its destination.
      if (tripRef.current) {
        const set = (end: 'from' | 'to') => {
          const pin: Place = { name: t.droppedPin, detail: '', ...here };
          setActive(0);
          setTrip((tr) => (tr ? { ...tr, [end]: pin } : tr));
          void lookup()
            .catch(() => null)
            .then((extra) =>
              setTrip((tr) =>
                tr && tr[end] === pin ? { ...tr, [end]: { ...pin, ...extra } } : tr,
              ),
            );
        };
        showToast(t.droppedPin, [
          { label: t.startHere, run: () => set('from') },
          { label: t.goHere, run: () => set('to') },
        ]);
        return;
      }
      select({ name: t.droppedPin, detail: '', ...here }, lookup);
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
  }, [map, select, clear, showToast]);

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
      // A place found by category comes from the map; its address comes from Photon.
      select(place, place.distance === undefined ? undefined : () => addressOf(place.name, place));
      const [w, s, e, n] = place.bbox ?? [0, 0, 0, 0];
      if (place.bbox && (e - w > 0.002 || n - s > 0.002)) {
        map.fitBounds(place.bbox, { padding: padding(), maxZoom: 17, duration: motion(1600) });
      } else {
        const zoom = Math.max(map.getZoom(), 16);
        map.flyTo({
          center: [place.lng, place.lat],
          zoom,
          padding: padding(),
          duration: motion(1600),
        });
      }
    },
    [map, select],
  );

  /** Places of a category, from the map's tiles; their dots stay until the search ends. */
  const category = useCategory(map, LABEL_LANG, routePadding);

  const bias = useCallback(() => {
    if (!map) return undefined;
    const c = map.getCenter().wrap();
    return { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
  }, [map]);

  // Location: the dot, and the camera while following.
  const me = useRef<ReturnType<typeof userMarker> | null>(null);
  /**
   * Fingers (or a mouse button) down on the map. The app's own camera moves wait meanwhile:
   * any move resets MapLibre's gesture handlers, which would cut a pan, pinch or long-press off
   * the moment it starts.
   */
  const touching = useRef(new Set<number>());
  useEffect(() => {
    if (!map) return;
    const m = userMarker(map);
    me.current = m;
    const down = (e: PointerEvent) => touching.current.add(e.pointerId);
    const up = (e: PointerEvent) => touching.current.delete(e.pointerId);
    const surface = map.getCanvasContainer();
    surface.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    const stopFollowing = () => {
      setFollow('off');
      if (navRef.current) setNavFollow(false);
    };
    // While navigating, a pinch or twist to look around holds the camera too (Re-centre returns).
    const lookAround = (e: { originalEvent?: Event }) => {
      if (e.originalEvent && navRef.current) setNavFollow(false);
    };
    const looks = ['zoomstart', 'rotatestart', 'pitchstart'] as const;
    map.on('dragstart', stopFollowing);
    for (const ev of looks) map.on(ev, lookAround);
    return () => {
      m.remove();
      surface.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      map.off('dragstart', stopFollowing);
      for (const ev of looks) map.off(ev, lookAround);
    };
  }, [map]);

  useEffect(() => {
    if (!map || !fix || (roadNavRef.current && trackingRef.current)) return;
    me.current?.update(fix);
    if (roadNavRef.current) {
      // Guidance is still waiting for its route: the dot and the camera follow the fix meanwhile.
      const bearing = fix.heading != null && (fix.speed ?? 0) > 2 ? fix.heading : compass.current();
      if (navFollowRef.current && !touching.current.size) {
        followNav(
          map,
          { center: [fix.lng, fix.lat], bearing, speed: fix.speed ?? 0 },
          motion(1000),
        );
      }
      return;
    }
    // A finger on the map: this fix moves the dot only; the next one catches the camera up.
    if (touching.current.size) return;
    if (flyOnFix.current) {
      flyOnFix.current = false;
      map.flyTo({
        center: [fix.lng, fix.lat],
        zoom: Math.max(map.getZoom(), 15),
        duration: motion(1800),
      });
    } else if (followRef.current === 'position') {
      // Never cut short a running camera move (the fly-in after tapping locate would stop at
      // globe zoom); catch up when it ends, since underground no further fix may come.
      const follow = () => map.easeTo({ center: [fix.lng, fix.lat], duration: motion(800) });
      if (!map.isMoving()) follow();
      else {
        map.once('moveend', () => {
          if (followRef.current === 'position' && !map.isMoving()) follow();
        });
      }
    } else if (followRef.current === 'compass') {
      // The compass turns the map every frame; an ease here would fight it, so the centre jumps.
      if (!map.isMoving()) map.jumpTo({ center: [fix.lng, fix.lat] });
    }
  }, [map, fix, compass]);

  // Compass: the beam on the dot always; in compass mode the map turns with the phone.
  const lastNavMoving = useRef(false);
  useEffect(() => {
    if (!map) return;
    let frame = 0;
    let latest = 0;
    const off = compass.subscribe((h) => {
      latest = h;
      if (roadNavRef.current) {
        // Slow or standing: GPS course is noise, so the arrow shows where the phone faces.
        if (!lastNavMoving.current) me.current?.heading(h);
        return;
      }
      me.current?.facing(h);
      if (followRef.current !== 'compass' || frame) return;
      const turn = () => {
        if (followRef.current !== 'compass') {
          frame = 0;
          return;
        }
        // Another camera move (e.g. the fly-in after tapping locate) runs, or a finger is on
        // the map: try again next frame.
        if (map.isMoving() || touching.current.size) {
          frame = requestAnimationFrame(turn);
          return;
        }
        frame = 0;
        // A turn too small to see is not worth a camera move (each one is a moveend).
        const delta = Math.abs(((latest - map.getBearing() + 540) % 360) - 180);
        if (delta >= 0.5) map.setBearing(latest);
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
  useRouteLayer(map, {
    routes: shown,
    chosen,
    navigating,
    ready: route.status === 'ready',
    tripKey: route.key,
    from: trip?.from ?? null,
    hasTrip: !!trip,
    padding: routePadding,
  });

  // Navigation: guidance on the device, camera behind the user, the router asked only to reroute.
  /** Public transport has no turn-by-turn yet, so guidance only ever sees a road mode. */
  const roadMode: Mode = trip && trip.mode !== 'transit' ? trip.mode : 'car';
  const guidance = useGuidance({
    map,
    meRef: me,
    compass,
    touchingRef: touching,
    followingRef: navFollowRef,
    movingRef: lastNavMoving,
    updateTheme: updateNavTheme,
    route: navigating && !riding ? shown[chosen] : undefined,
    mode: roadMode,
    active: navigating && !riding,
    subscribe,
    last: fix,
    voice,
    muted,
    settled: route.settled,
    kept: route.kept,
    retry: route.retry,
  });
  const { nav, rerouteState } = guidance;
  useEffect(() => {
    trackingRef.current = guidance.tracking;
  }, [guidance.tracking]);

  const ride = useRide({
    transit: shown[chosen]?.transit,
    active: riding,
    fix,
    subscribe,
    voice,
    muted,
    lang,
    say: (tr, p) => rideWords(tr, p, trip?.to.name ?? '', locale),
  });
  // Public transport turns the map dark after sunset too; tunnels are the driver's concern.
  const rideFix = ride?.st.fix;
  const rideTime = ride?.st.time;
  useEffect(() => {
    if (rideFix && rideTime) updateRideTheme(rideFix, rideTime);
  }, [rideFix, rideTime, updateRideTheme]);

  const startNav = () => {
    if (!trip) return;
    beginVoice(trip.mode);
    if (trip.mode === 'transit') {
      // The connection stays as planned, from wherever it starts; the map follows the dot.
      start();
      void compass.start();
      setNavigating(true);
      setFollow('position');
      if (!isNative) showToast(t.keepOpen);
      map?.easeTo({
        ...(fix ? { center: [fix.lng, fix.lat] as [number, number] } : {}),
        zoom: Math.max(map.getZoom(), 16),
        pitch: 0,
        bearing: 0,
        padding: NO_PADDING,
        duration: motion(800),
      });
      return;
    }
    start();
    void compass.start();
    if (trip.from) setTrip({ ...trip, from: null });
    setNavigating(true);
    setNavFollow(true);
    if (!isNative) showToast(t.keepOpen);
    // With a fix, guidance places the camera on the user at once; without one, the route's start.
    const first = shown[chosen];
    if (map && first && !(fix && Date.now() - fix.time < FRESH_MS)) {
      followNav(
        map,
        { center: first.coords[0], bearing: startBearing(first), speed: 0 },
        motion(800),
      );
    }
  };
  const endNav = useCallback(() => {
    setNavigating(false);
    // At once, not after the next render: a compass reading in between would bring the arrow back.
    navRef.current = false;
    roadNavRef.current = false;
    voice.stop();
    me.current?.heading(null);
    map?.easeTo({ pitch: 0, bearing: 0, padding: NO_PADDING, duration: motion(800) });
  }, [map, voice]);
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
      // Ask again: the user may have allowed it in the settings since.
      showToast(
        t.locationDenied,
        openAppSettings ? [{ label: t.settings, run: openAppSettings }] : undefined,
      );
      start();
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
      map?.easeTo({ bearing: 0, duration: motion(500) });
      return;
    }
    setFollow('position');
    if (fix && map) {
      map.flyTo({
        center: [fix.lng, fix.lat],
        zoom: Math.max(map.getZoom(), 15),
        duration: motion(1400),
      });
    } else {
      flyOnFix.current = true;
    }
  };

  const arrived = navigating && (riding ? ride?.st.phase === 'arrived' : nav.arrived);
  /** Arrived: guidance and the trip are done; the destination's card is what is left. */
  const finish = useCallback(() => {
    endNav();
    closeRoute();
  }, [endNav, closeRoute]);
  useEffect(() => {
    if (!arrived) return;
    const id = setTimeout(finish, ARRIVED_END_MS);
    return () => clearTimeout(id);
  }, [arrived, finish]);

  // Back (Android) and Escape close one layer at a time; navigation needs a second press.
  const backAt = useRef(0);
  useBack((via) => {
    if (about) setAbout(false);
    else if (navigating) {
      if (arrived) finish();
      else if (Date.now() - backAt.current < BACK_TWICE_MS) endNav();
      else {
        backAt.current = Date.now();
        showToast(via === 'escape' ? t.escToEnd : t.backToEnd);
      }
    } else if (picking) setPicking(null);
    else if (trip) closeRoute();
    else if (selection) clear();
    else return false;
    return true;
  });
  const offline = useOffline(map);

  useAutoLocate(map, start, flyOnFix);

  // The one gesture nothing on screen shows: said once, on the first visit.
  useEffect(() => {
    if (!map || stored(HINTED_KEY)) return;
    const id = setTimeout(() => {
      store(HINTED_KEY, '1');
      showToast(touch() ? t.hint : t.hintMouse);
    }, 1500);
    return () => clearTimeout(id);
  }, [map, showToast]);

  const panelRef = usePanel(map, sel && !trip && !navigating ? sel : null, selection?.loading);

  return (
    <>
      <div ref={mapEl} className="map" />
      <main className="ui" data-nav={navigating || undefined}>
        {riding && ride && (
          <RideView
            transit={ride.transit}
            st={ride.st}
            destination={trip.to.name}
            lang={locale}
            muted={muted}
            following={follow !== 'off'}
            onMute={toggleMute}
            onRecenter={() => {
              setFollow('position');
              if (fix) map?.easeTo({ center: [fix.lng, fix.lat], duration: motion(600) });
            }}
            onNewConnection={() => {
              setActive(0);
              setTrip({ ...trip, from: null, at: null });
              route.retry();
            }}
            onEnd={arrived ? finish : endNav}
          />
        )}
        {navigating && !riding && shown[chosen] && (
          <NavView
            route={shown[chosen]}
            mode={roadMode}
            nav={nav}
            lang={locale}
            muted={muted}
            following={navFollow}
            reroute={rerouteState}
            onMute={toggleMute}
            destination={trip?.to.name ?? ''}
            onRecenter={() => {
              setNavFollow(true);
              guidance.recenter();
            }}
            onEnd={arrived ? finish : endNav}
          />
        )}
        {navigating && trip && !(riding ? ride : shown[chosen]) && (
          <NavWaiting
            status={route.status}
            location={status}
            destination={trip.to.name}
            muted={muted}
            onMute={toggleMute}
            onRetry={route.retry}
            onEnd={endNav}
          />
        )}
        <div className="panel" ref={panelRef} hidden={navigating}>
          {/* Nothing in it renders while guiding: every fix would redraw it for nobody. */}
          {!navigating && (
            <>
              {trip && !picking && (
                <RouteCard
                  to={trip.to}
                  from={trip.from}
                  mode={trip.mode}
                  routes={shown}
                  active={chosen}
                  status={route.status}
                  location={status}
                  lang={locale}
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
                  onStart={startNav}
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
                  onCategory={category.onCategory}
                  categoryRun={category.run}
                  onShowAll={category.showAll}
                  collapsed={!!selection && !picking}
                  onFocus={picking ? () => undefined : clear}
                  placeholder={
                    picking === 'start'
                      ? t.searchStart
                      : picking === 'end'
                        ? t.searchEnd
                        : undefined
                  }
                  autoFocus={!!picking}
                  onCancel={picking ? () => setPicking(null) : undefined}
                />
              )}
            </>
          )}
        </div>
        {offline && !navigating && (
          <div className="offline surface" role="status">
            {t.mapOffline}
          </div>
        )}
        {category.offerHere && !navigating && !trip && !offline && (
          <button type="button" className="search-here surface" onClick={category.searchHere}>
            {t.searchHere}
          </button>
        )}
        {!navigating && (
          <Controls
            map={map}
            status={status}
            follow={follow}
            onLocate={locate}
            onNorth={() => {
              if (follow === 'compass') setFollow('position');
              map?.easeTo({ bearing: 0, pitch: 0, duration: motion(500) });
            }}
          />
        )}
        <button
          type="button"
          className="credit"
          aria-label={`© OpenStreetMap · ${t.about}`}
          onClick={() => setAbout(true)}
        >
          © OpenStreetMap
        </button>
      </main>
      {about && <About onClose={() => setAbout(false)} />}
      <Toasts toast={toast} dismiss={dismiss} guiding={navigating} />
    </>
  );
}
