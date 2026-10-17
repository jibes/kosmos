import type * as maplibregl from 'maplibre-gl';
import { boundsOf, navPitch, navZoomFor } from '../core/navView';
import type { Mode } from '../core/route';

/** The side layout: wide screens, and phones held sideways (the same query as styles.css). */
export const wide = () =>
  matchMedia('(min-width: 900px), (orientation: landscape) and (min-width: 560px)').matches;

/** Room kept round a fitted route's ends: the start dot and the destination pin above its point. */
const ENDS_PX = 56;

/** The side layout's gutter, as in styles.css. */
const WIDE_GUTTER = 16;

/** The side column's width (panel, banner, bar): `--side-w` in styles.css. */
export const sideWidth = () => Math.min(400, Math.max(320, innerWidth * 0.48));

/** Where the map beside the column begins, plus a margin. */
const beside = (margin: number) => Math.round(WIDE_GUTTER + sideWidth() + margin);

/** Keeps a selected place clear of the panel that describes it, before the card is measured. */
export const padding = () =>
  wide()
    ? { top: 48, bottom: 48, left: beside(24), right: 48 }
    : { top: 96, bottom: 300, left: 32, right: 32 };

/**
 * While navigating, the user sits low on screen so more of the road ahead shows: about a
 * quarter of the height from the bottom beside the column, where nothing else is.
 */
export const navPadding = () =>
  wide()
    ? { top: Math.round(innerHeight * 0.55), bottom: 16, left: beside(WIDE_GUTTER), right: 0 }
    : { top: Math.round(innerHeight * 0.42), bottom: 110, left: 0, right: 0 };

export const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

/** Fits a route, a place or category results into the map area the panel leaves free, measured. */
export const routePadding = () => {
  const panel = document.querySelector('.panel')?.getBoundingClientRect();
  if (wide()) {
    return {
      top: ENDS_PX + 16,
      bottom: ENDS_PX,
      left: (panel?.right ?? beside(0)) + ENDS_PX,
      right: 104,
    };
  }
  // Clear of the map buttons on the right, with room for the start dot and the destination pin.
  const bottom = panel && panel.height ? innerHeight - panel.top + 32 : 380;
  return { top: 104, bottom: Math.min(bottom, innerHeight - 240), left: ENDS_PX, right: 96 };
};

/** A finger long-presses; a mouse right-clicks. */
export const touch = () => matchMedia('(pointer: coarse)').matches;

/**
 * Where the navigation camera looks: the arrow's place and heading, the speed for zoom, and the
 * way of travel for the angle and distance it looks from.
 */
export interface NavCamera {
  center: [number, number];
  bearing: number | null;
  speed: number;
  mode: Mode;
}

const RAD = Math.PI / 180;

/** The direction a route sets off in, degrees clockwise from north. */
export function startBearing(route: { coords: [number, number][] }): number {
  const [a, b] = [route.coords[0], route.coords[1] ?? route.coords[0]];
  return (Math.atan2((b[0] - a[0]) * Math.cos(a[1] * RAD), b[1] - a[1]) / RAD + 360) % 360;
}

/**
 * Room around an overview while guiding, measured: below the banner, above the bar, the map
 * buttons' side kept clear, so start and destination are both in sight, not at the edge.
 */
const overviewPadding = () => {
  const banner = document.querySelector('.nav-banner')?.getBoundingClientRect();
  const bar = document.querySelector('.nav-bar')?.getBoundingClientRect();
  if (wide()) return { top: ENDS_PX, bottom: ENDS_PX, left: beside(ENDS_PX), right: 72 };
  const top = banner && banner.height ? banner.bottom : innerHeight * 0.3;
  const bottom = bar && bar.height ? innerHeight - bar.top : 150;
  return {
    top: Math.round(top + ENDS_PX),
    bottom: Math.round(bottom + ENDS_PX),
    // A phone is narrow: the pin's centre a fifth in, not a thumb's width from the edge.
    left: Math.max(ENDS_PX, Math.round(innerWidth * 0.18)),
    right: Math.max(72, Math.round(innerWidth * 0.18)),
  };
};

/**
 * Off the route: the user and the nearest point of it both in view, from above, so the way
 * back is plain. Linear like the follow camera, which takes over again back on the route.
 */
export function overviewNav(
  map: maplibregl.Map,
  a: [number, number],
  b: [number, number],
  bearing: number | null,
  duration: number,
) {
  map.fitBounds(
    [
      [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
      [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
    ],
    {
      padding: overviewPadding(),
      absolutePadding: true,
      bearing: bearing ?? map.getBearing(),
      pitch: 0,
      maxZoom: 17,
      linear: true,
      duration,
      easing: (x) => x,
    },
  );
}

/**
 * What is left of the way, all of it on screen, north up and from above: the overview while
 * guiding, and on board a vehicle the rest of its line. Linear, as the follow camera.
 */
/** The latest overview asked for per map, so a flattening left behind does not fit after it. */
const fits = new WeakMap<maplibregl.Map, number>();

export function fitNav(map: maplibregl.Map, points: [number, number][], duration: number) {
  const b = boundsOf(points);
  if (!b) return;
  const fit = (ms: number) =>
    map.fitBounds(b, {
      padding: overviewPadding(),
      absolutePadding: true,
      bearing: 0,
      pitch: 0,
      maxZoom: 17,
      linear: true,
      duration: ms,
      easing: (x) => x,
    });
  const id = (fits.get(map) ?? 0) + 1;
  fits.set(map, id);
  // Tilted, zooming out shows far past the route until the tilt is gone: it seems to zoom out
  // and then back in. Flat first, then the fit.
  if (map.getPitch() < 1 || duration === 0) return fit(duration);
  const flat = Math.min(300, duration / 2);
  map.easeTo({ pitch: 0, bearing: 0, duration: flat });
  map.once('moveend', () => {
    // Not when something else moved the camera since: Re-centre, a fix's follow, a finger.
    if (fits.get(map) === id && !map.isMoving()) fit(duration - flat);
  });
}

/** Behind the user, looking ahead; linear, so one fix's move runs into the next. */
export function followNav(map: maplibregl.Map, v: NavCamera, duration: number) {
  fits.set(map, (fits.get(map) ?? 0) + 1);
  map.easeTo({
    center: v.center,
    bearing: v.bearing ?? map.getBearing(),
    pitch: navPitch(v.mode),
    zoom: navZoomFor(v.mode, v.speed),
    padding: navPadding(),
    duration,
    easing: (x) => x,
  });
}

/** The map's centre is more than a thumb's width from `p`. */
export function offCentre(map: maplibregl.Map, p: { lng: number; lat: number }) {
  const a = map.project([p.lng, p.lat]);
  const c = map.project(map.getCenter());
  return Math.hypot(a.x - c.x, a.y - c.y) > 48;
}
