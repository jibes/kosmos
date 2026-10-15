import type * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Place } from './core/search';
import type { Mode, TravelMode } from './core/route';
import { lang, locale, t } from './i18n';
import { About } from './ui/About';
import { Controls, type Follow } from './ui/Controls';
import { pinMarker, userMarker } from './ui/markers';
import { isNative, openAppSettings } from './ui/native';
import { NavView, NavWaiting } from './ui/NavView';
import { PlaceCard } from './ui/PlaceCard';
import { connectionStart, RideView, rideWords } from './ui/RideView';
import { RouteCard } from './ui/RouteCard';
import { SearchBar, useSearch } from './ui/SearchBar';
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
import { NO_PADDING, followNav, padding, routePadding, startBearing } from './ui/layout';
import { MODE_KEY, store, storedMode } from './ui/prefs';
import { useAutoLocate, usePanel } from './ui/usePanel';
import { useBack } from './ui/useBack';
import { useNavTheme, useStatusBar } from './ui/useNavTheme';
import { useOffline } from './ui/useOffline';
import { addressOf, useMapTaps, type Enrich } from './ui/useMapTaps';
import { useHint } from './ui/useHint';
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
  const { toast, showToast, dismiss, dismissText } = useToast();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [active, setActive] = useState(0);
  /** Which end of the route the search bar is choosing, if any. */
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const pickingRef = useRef(picking);
  useEffect(() => {
    pickingRef.current = picking;
  }, [picking]);
  const [navFollow, setNavFollow] = useState(true);
  /** The router answer count when a new connection was asked for. */
  const [connAt, setConnAt] = useState<number | null>(null);
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
  const followRef = useRef(follow);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  /**
   * Shows a place at once, then fills in its details when the lookup returns. Looking at a place
   * stops following (the camera would tug it away) and any late fly to the first fix.
   */
  const select = useCallback((place: Place, enrich?: Enrich) => {
    const token = ++pending.current;
    flyOnFix.current = false;
    setFollow('off');
    setSelection({ place, loading: !!enrich });
    enrich?.()
      .catch(() => null)
      .then((extra) => {
        if (token !== pending.current) return;
        const full = { ...place, ...extra };
        setSelection({ place: full, loading: false });
        // A route opened meanwhile goes there by its name too, not "Dropped pin".
        setTrip((tr) => (tr?.to === place ? { ...tr, to: full } : tr));
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

  useMapTaps(map, {
    labelLang: LABEL_LANG,
    select,
    clear,
    showToast,
    tripRef,
    navRef,
    setActive,
    setTrip,
  });

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
      select(
        place,
        place.distance === undefined
          ? undefined
          : () => addressOf(place.unnamed ? '' : place.name, place),
      );
      const [w, s, e, n] = place.bbox ?? [0, 0, 0, 0];
      if (place.bbox && (e - w > 0.002 || n - s > 0.002)) {
        // Its own padding only: an earlier pick's stays on the camera and would count twice.
        map.fitBounds(place.bbox, {
          padding: padding(),
          absolutePadding: true,
          maxZoom: 17,
          duration: motion(1600),
        });
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
  /** The ride's whole trip, open under its banner: a step of its own for Back. */
  const [tripList, setTripList] = useState(false);
  if (tripList && !riding) setTripList(false);
  /** What is searched for, kept while a route covers the search bar, dots and all. */
  const search = useSearch();
  const category = useCategory(map, LABEL_LANG, routePadding, !!trip, fix);

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
    // The user's own move: a fix arriving late no longer flies the map away from it.
    const stopFollowing = () => {
      flyOnFix.current = false;
      setFollow('off');
      if (navRef.current) setNavFollow(false);
    };
    // While navigating, a pinch or twist to look around holds the camera too (Re-centre returns).
    const lookAround = (e: { originalEvent?: Event }) => {
      if (!e.originalEvent) return;
      flyOnFix.current = false;
      if (navRef.current) setNavFollow(false);
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

  /** The newest fix, and whether a catch-up waits for the camera to stop. */
  const latestFix = useRef(fix);
  const catchingUp = useRef(false);
  useEffect(() => {
    latestFix.current = fix;
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
      // globe zoom); catch up when it ends, to the newest fix, since underground no further
      // fix may come.
      const follow = () => {
        const f = latestFix.current;
        if (f) map.easeTo({ center: [f.lng, f.lat], duration: motion(800) });
      };
      if (!map.isMoving()) follow();
      else if (!catchingUp.current) {
        catchingUp.current = true;
        map.once('moveend', () => {
          catchingUp.current = false;
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

  // A new connection: the one followed stays until the answer comes, then the first of it.
  if (connAt !== null && route.settled !== connAt && !route.kept) {
    setConnAt(null);
    setActive(0);
  }
  const connecting = connAt === null ? 'idle' : route.settled === connAt ? 'asking' : 'failed';
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
    setConnAt(null);
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
      if (riding && tripList) setTripList(false);
      else if (arrived) finish();
      else if (Date.now() - backAt.current < BACK_TWICE_MS) endNav();
      else {
        backAt.current = Date.now();
        showToast(via === 'escape' ? t.escToEnd : t.backToEnd);
      }
    } else if (picking) setPicking(null);
    else if (trip) closeRoute();
    else if (selection) clear();
    else if (search.query) search.clear();
    else return false;
    return true;
  });
  const offline = useOffline(map);

  useAutoLocate(map, start, flyOnFix);

  useHint(map, showToast, dismissText, !!selection || !!trip || navigating);

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
            connecting={connecting}
            onNewConnection={() => {
              setConnAt(route.settled);
              setTrip({
                ...trip,
                from: connectionStart(ride.transit, ride.st, Date.now()),
                at: null,
              });
              route.retry();
            }}
            onEnd={arrived ? finish : endNav}
            open={tripList}
            onOpen={setTripList}
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
              <SearchBar
                search={search}
                hidden={!!trip}
                lang={lang}
                bias={bias}
                onPick={pick}
                onCategory={category.onCategory}
                categoryRun={category.run}
                onShowAll={category.showAll}
                collapsed={!!selection}
                onFocus={clear}
              />
              {/* A route's start or destination: by name only, its own field. */}
              {picking && (
                <SearchBar
                  key={picking}
                  lang={lang}
                  bias={bias}
                  onPick={pick}
                  collapsed={false}
                  onFocus={() => undefined}
                  placeholder={picking === 'start' ? t.searchStart : t.searchEnd}
                  autoFocus
                  onCancel={() => setPicking(null)}
                />
              )}
            </>
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
              map?.easeTo({ bearing: 0, pitch: 0, duration: motion(500) });
            }}
          />
        )}
        <button
          type="button"
          className="credit"
          aria-label={`© OpenStreetMap · ${t.about}`}
          title={t.about}
          onClick={() => setAbout(true)}
        >
          © OpenStreetMap
        </button>
        <div className="notes">
          <Toasts toast={toast} dismiss={dismiss} guiding={navigating} />
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
        </div>
      </main>
      {about && <About onClose={() => setAbout(false)} />}
    </>
  );
}
