import type * as maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Place } from './core/search';
import { roadModeOf, type TravelMode } from './core/route';
import { departed } from './core/transit';
import { lang, locale, t } from './i18n';
import { About } from './ui/About';
import { Controls, type Follow } from './ui/Controls';
import { pinMarker, type userMarker } from './ui/markers';
import { isNative, openAppSettings } from './ui/native';
import { NavView, NavWaiting } from './ui/NavView';
import { PlaceCard } from './ui/PlaceCard';
import { connectionStart, RideView, rideWords } from './ui/RideView';
import { focusSearch } from './ui/a11y';
import { ResultsSheet } from './ui/ResultsSheet';
import { RouteCard } from './ui/RouteCard';
import { SearchBar, useSearch } from './ui/SearchBar';
import { Toasts, useToast } from './ui/Toasts';
import { useLocation } from './ui/useLocation';
import { useCompass } from './ui/useCompass';
import { useCompassFollow } from './ui/useCompassFollow';
import { useShared } from './ui/useShared';
import { useMap } from './ui/useMap';
import { ASKED, useCategory } from './ui/useCategory';
import { useRide } from './ui/useRide';
import { useRideCamera } from './ui/useRideCamera';
import { useNavView } from './ui/useNavView';
import { useNavControls } from './ui/useNavControls';
import { useFixCamera } from './ui/useFixCamera';
import { logEvent } from './ui/usageLog';
import { useMapGestures } from './ui/useMapGestures';
import { useRoute, type Trip } from './ui/useRoute';
import { useGuidance } from './ui/useGuidance';
import { FRESH_MS } from './ui/useNav';
import { useRouteLayer } from './ui/useRouteLayer';
import { motion } from './ui/motion';
import { NO_PADDING, followNav, offCentre, padding, routePadding, startBearing } from './ui/layout';
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
  const [trip, setTrip] = useState<Trip | null>(null);
  const {
    theme: navTheme,
    update: updateNavTheme,
    updateNight: updateRideTheme,
  } = useNavTheme(navigating, trip?.mode === 'car' || trip?.mode === 'bike');
  const theme = navTheme ?? systemTheme;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useStatusBar(navTheme);
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useMap(mapEl, theme, LABEL_LANG);
  const { fix, status, start, subscribe, background } = useLocation();
  /** Off, follow the position north-up, or follow and turn the map with the compass. */
  const [follow, setFollowState] = useState<Follow>('off');
  const followRef = useRef(follow);
  /** The ref at once too: the camera code reads it before the next render. */
  const setFollow = useCallback((f: Follow) => {
    followRef.current = f;
    setFollowState(f);
  }, []);
  const compass = useCompass(fix);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [about, setAbout] = useState(false);
  const { toast, showToast, dismiss, dismissText } = useToast();
  const [active, setActive] = useState(0);
  /** Which end of the route the search bar is choosing, if any. */
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const pickingRef = useRef(picking);
  useEffect(() => {
    pickingRef.current = picking;
  }, [picking]);
  const view = useNavView();
  /** The router answer count when a new connection was asked for. */
  const [connAt, setConnAt] = useState<number | null>(null);
  /** The drive set off on a toll-free route chosen over toll ones: its reroutes stay so. */
  const [tollFree, setTollFree] = useState(false);
  const route = useRoute(trip, fix, lang, navigating, tollFree);
  // The voice speaks the language of the words it is given: the UI's (and the router's).
  const voice = useMemo(() => systemVoice(locale), []);
  const { muted, begin: beginVoice, toggle: toggleMute } = useMuted(voice);
  const navRef = useRef(false);
  /** Road navigation owns the camera and the arrow; public transport only follows the dot. */
  const riding = navigating && trip?.mode === 'transit';
  const roadNavRef = useRef(false);
  /** Road guidance has its route and drives the arrow and the camera itself. */
  const trackingRef = useRef(false);
  useEffect(() => {
    navRef.current = navigating;
    roadNavRef.current = navigating && !riding;
  }, [navigating, riding]);
  const tripRef = useRef(trip);
  useEffect(() => {
    tripRef.current = trip;
  }, [trip]);
  const pending = useRef(0);
  const flyOnFix = useRef(false);

  /**
   * Shows a place at once, then fills in its details when the lookup returns. Looking at a place
   * stops following (the camera would tug it away) and any late fly to the first fix.
   */
  const select = useCallback(
    (place: Place, enrich?: Enrich) => {
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
    },
    [setFollow],
  );

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
  }, [selection, start, setFollow]);

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
      // A place found by category comes from the map; its address comes from Photon. (Names
      // shown all at once have a distance too, and their address already.)
      select(
        place,
        place.distance === undefined || place.detail
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
    [map, select, setFollow],
  );

  /** Places of a category, from the map's tiles; their dots stay until the search ends. */
  /** The ride's whole trip, open under its banner: a step of its own for Back. */
  const [tripList, setTripList] = useState(false);
  if (tripList && !navigating) setTripList(false);
  /** What is searched for, kept while a route covers the search bar, dots and all. */
  const search = useSearch();
  /** "Nearby" on a place card: distances count from that place while it is in view. */
  const [near, setNear] = useState<Place | null>(null);
  const lookAway = useCallback(() => {
    flyOnFix.current = false;
    setFollow('off');
  }, [setFollow]);
  const category = useCategory(map, LABEL_LANG, routePadding, !!trip, near ?? fix, lookAway);

  const bias = useCallback(() => {
    if (!map) return undefined;
    const c = map.getCenter().wrap();
    return { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
  }, [map]);

  // Location: the dot, and the camera while following.
  const me = useRef<ReturnType<typeof userMarker> | null>(null);
  const touching = useRef(new Set<number>());
  useMapGestures(map, me, touching, {
    // The user's own move: a fix arriving late no longer flies the map away from it.
    drag: () => {
      if (navRef.current) logEvent('cam.drag', { overview: view.overviewRef.current });
      flyOnFix.current = false;
      setFollow('off');
      view.setOverview(false);
    },
    // Zoom and tilt are the user's: following goes on with them; the overview is left.
    look: () => {
      if (navRef.current) logEvent('cam.look', { overview: view.overviewRef.current });
      flyOnFix.current = false;
      if (!view.overviewRef.current) view.looked();
      else {
        view.setOverview(false);
        setFollow('off');
      }
    },
  });

  useFixCamera(map, fix, {
    me,
    compass,
    followRef,
    touching,
    tripRef,
    navRef,
    roadNavRef,
    trackingRef,
    flyOnFix,
  });

  // Compass: the beam on the dot always; in compass mode the map turns with the phone.
  const lastNavMoving = useRef(false);
  useCompassFollow(map, compass, {
    me,
    roadNavRef,
    navMovingRef: lastNavMoving,
    followRef,
    touching,
    setFollow,
  });

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
  const roadMode = roadModeOf(trip);
  const guided = navigating && !riding ? shown[chosen] : undefined;
  const guidance = useGuidance({
    map,
    meRef: me,
    compass,
    touchingRef: touching,
    followRef,
    overviewRef: view.overviewRef,
    adjustRef: view.adjustRef,
    lookedRef: view.lookedRef,
    movingRef: lastNavMoving,
    updateTheme: updateNavTheme,
    route: guided,
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
  const navControls = useNavControls({
    map,
    follow,
    setFollow,
    view,
    canTurn: !riding || compass.available,
    recenter: guidance.recenter,
  });
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
  const { overview } = view;
  useRideCamera({ map, ride, follow, overview, touchingRef: touching });
  // Public transport turns the map dark after sunset too; tunnels are the driver's concern.
  const rideFix = ride?.st.fix;
  const rideTime = ride?.st.time;
  useEffect(() => {
    if (rideFix && rideTime) updateRideTheme(rideFix, rideTime);
  }, [rideFix, rideTime, updateRideTheme]);

  const startNav = () => {
    if (!trip) return;
    logEvent('nav.start', { mode: trip.mode });
    beginVoice(trip.mode);
    // A plan for "now" left open until its first vehicle has gone: the next ones instead.
    const tr = shown[chosen]?.transit;
    if (trip.mode === 'transit' && !trip.at && tr && departed(tr, Date.now())) {
      route.retry();
      showToast(t.replanned);
      return;
    }
    if (trip.mode === 'transit') {
      // The connection stays as planned, from wherever it starts; the map follows the dot.
      // In the app, location comes from its service, which asks for it (see `background`).
      if (!isNative) start();
      void compass.start();
      setNavigating(true);
      view.reset();
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
    if (!isNative) start();
    void compass.start();
    if (trip.from) setTrip({ ...trip, from: null });
    setNavigating(true);
    view.reset();
    // Heading-up behind the user, as drivers expect; the location button cycles from there.
    setFollow('compass');
    if (!isNative) showToast(t.keepOpen);
    const first = shown[chosen];
    setTollFree(!!first && !first.toll && shown.some((r) => r.toll));
    // With a fix, guidance places the camera on the user at once; without one, the route's start.
    if (map && first && !(fix && Date.now() - fix.time < FRESH_MS)) {
      followNav(
        map,
        { center: first.coords[0], bearing: startBearing(first), speed: 0, mode: roadMode },
        motion(800),
      );
    }
  };
  const endNav = useCallback(() => {
    logEvent('nav.end', { arrived: nav.arrived });
    setNavigating(false);
    setConnAt(null);
    // At once, not after the next render: a compass reading in between would bring the arrow back.
    navRef.current = false;
    roadNavRef.current = false;
    voice.stop();
    me.current?.heading(null);
    // Back on the map following north up, if following at all.
    if (followRef.current !== 'off') setFollow('position');
    map?.easeTo({ pitch: 0, bearing: 0, padding: NO_PADDING, duration: motion(800) });
  }, [map, voice, setFollow, nav.arrived]);
  useEffect(() => {
    if (!navigating) return;
    background(true, () =>
      showToast(
        t.needPrecise,
        openAppSettings ? [{ label: t.settings, run: openAppSettings }] : undefined,
      ),
    );
    const release = keepAwake();
    return () => {
      release();
      background(false);
    };
  }, [navigating, background, showToast]);

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
    // The user's own place again: distances count from there, not from a "nearby" place.
    setNear(null);
    if (navigating && navControls.locate()) return;
    // Following, yet the map shows somewhere else (a fit to results): back to the user first.
    if (follow !== 'off' && fix && map && !map.isMoving() && offCentre(map, fix)) {
      map.flyTo(
        { center: [fix.lng, fix.lat], zoom: Math.max(map.getZoom(), 15), duration: motion(1400) },
        ASKED,
      );
      return;
    }
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
      map.flyTo(
        { center: [fix.lng, fix.lat], zoom: Math.max(map.getZoom(), 15), duration: motion(1400) },
        ASKED,
      );
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
      if (tripList) setTripList(false);
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
  useShared(map, select, search.setQuery);

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
            onMute={toggleMute}
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
            open={tripList}
            onOpen={setTripList}
            reroute={rerouteState}
            onMute={toggleMute}
            destination={trip?.to.name ?? ''}
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
                  onSwap={
                    trip.from || fix
                      ? () => {
                          // "My location" as the destination is the position now; swapped
                          // back, it is the live position again.
                          const here = fix && {
                            name: t.myLocation,
                            detail: '',
                            lng: fix.lng,
                            lat: fix.lat,
                            here: true,
                          };
                          const from = trip.from ?? here;
                          if (!from) return;
                          setActive(0);
                          setTrip({ ...trip, from: trip.to.here ? null : trip.to, to: from });
                        }
                      : undefined
                  }
                  onRetry={route.retry}
                  onClose={closeRoute}
                  // Guidance starts from where the user is: not to there.
                  onStart={trip.to.here ? undefined : startNav}
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
                  onNearby={() => {
                    const p = selection.place;
                    logEvent('place.nearby');
                    setNear(p);
                    search.clear();
                    map?.easeTo({
                      center: [p.lng, p.lat],
                      zoom: Math.max(map.getZoom(), 15),
                      padding: routePadding(),
                      duration: motion(600),
                    });
                    // In the tap itself, so a phone opens its keyboard; focus closes the card.
                    focusSearch();
                  }}
                />
              )}
              {/* What a search put on the map, by distance; under a place card it waits. */}
              {search.category && !trip && (
                <ResultsSheet
                  key={search.category}
                  label={search.query.trim()}
                  places={
                    category.results?.kind === search.category ? category.results.places : null
                  }
                  failed={category.results?.kind === search.category && category.results.failed}
                  lang={lang}
                  onPick={pick}
                  hidden={!!selection}
                  opened={selection?.place ?? null}
                  onHighlight={category.highlight}
                />
              )}
              <SearchBar
                search={search}
                hidden={!!trip}
                lang={lang}
                bias={bias}
                onPick={pick}
                onCategory={category.onCategory}
                onNames={category.names}
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
        <Controls
          map={map}
          status={status}
          follow={overview ? 'off' : follow}
          guiding={navigating}
          onLocate={locate}
          onNorth={() => {
            if (navigating) return navControls.north();
            if (follow === 'compass') setFollow('position');
            map?.easeTo({ bearing: 0, pitch: 0, duration: motion(500) });
          }}
          overview={navigating ? overview : undefined}
          onOverview={navControls.toggleOverview}
        />
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
