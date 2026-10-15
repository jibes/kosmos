import type * as maplibregl from 'maplibre-gl';
import { navZoom } from '../core/nav';

/** The side layout: wide screens, and phones held sideways (the same query as styles.css). */
export const wide = () =>
  matchMedia('(min-width: 900px), (orientation: landscape) and (min-width: 560px)').matches;

/** Keeps a selected place clear of the panel that describes it, before the card is measured. */
export const padding = () =>
  wide()
    ? { top: 48, bottom: 48, left: 440, right: 48 }
    : { top: 96, bottom: 300, left: 32, right: 32 };

/** While navigating, the user sits low on screen so more of the road ahead shows. */
export const navPadding = () =>
  wide()
    ? { top: Math.round(innerHeight * 0.3), bottom: 60, left: 440, right: 0 }
    : { top: Math.round(innerHeight * 0.42), bottom: 110, left: 0, right: 0 };

export const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

/** Fits a route, a place or category results into the map area the panel leaves free, measured. */
export const routePadding = () => {
  const panel = document.querySelector('.panel')?.getBoundingClientRect();
  if (wide()) return { top: 64, bottom: 64, left: (panel?.right ?? 420) + 48, right: 96 };
  const bottom = panel && panel.height ? innerHeight - panel.top + 24 : 380;
  return { top: 96, bottom: Math.min(bottom, innerHeight - 220), left: 40, right: 80 };
};

/** A finger long-presses; a mouse right-clicks. */
export const touch = () => matchMedia('(pointer: coarse)').matches;

/** Where the navigation camera looks: the arrow's place and heading, and the speed for zoom. */
export interface NavCamera {
  center: [number, number];
  bearing: number | null;
  speed: number;
}

const RAD = Math.PI / 180;

/** The direction a route sets off in, degrees clockwise from north. */
export function startBearing(route: { coords: [number, number][] }): number {
  const [a, b] = [route.coords[0], route.coords[1] ?? route.coords[0]];
  return (Math.atan2((b[0] - a[0]) * Math.cos(a[1] * RAD), b[1] - a[1]) / RAD + 360) % 360;
}

/** Room around an overview while guiding: the banner on top, the bar at the bottom. */
const overviewPadding = () =>
  wide()
    ? { top: 64, bottom: 64, left: 480, right: 64 }
    : { top: Math.round(innerHeight * 0.3), bottom: 150, left: 48, right: 48 };

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

/** Behind the user, looking ahead; linear, so one fix's move runs into the next. */
export function followNav(map: maplibregl.Map, v: NavCamera, duration: number) {
  map.easeTo({
    center: v.center,
    bearing: v.bearing ?? map.getBearing(),
    pitch: 55,
    zoom: navZoom(v.speed),
    padding: navPadding(),
    duration,
    easing: (x) => x,
  });
}
