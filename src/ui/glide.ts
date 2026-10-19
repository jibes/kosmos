import type * as maplibregl from 'maplibre-gl';
import {
  ease,
  glideStep,
  HEADING_TAU_S,
  settled,
  turnToward,
  type Aim,
  type Shown,
} from '../core/glide';
import type { Track } from '../core/nav';

export type { Aim } from '../core/glide';

/** What the camera shows while following: everything but the centre, which is the arrow. */
export interface CameraAt {
  bearing: number;
  zoom: number;
  pitch: number;
  padding: maplibregl.PaddingOptions;
}

/** Of the follow camera's zoom and tilt, seconds. */
const CAMERA_TAU_S = 0.4;

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Degrees between two headings, the short way. */
const turned = (a: number, b: number) => Math.abs(((((b - a) % 360) + 540) % 360) - 180);
/** Less than this on screen is not drawn, px. */
const MIN_PX = 0.25;

/**
 * The arrow and the follow camera while guiding: one loop of frames that runs while there is
 * anything to move (`core/glide.ts` says where the arrow is each frame), the camera's centre
 * on the arrow and its turn, zoom and tilt easing toward what the last fix asked for, from
 * wherever the map is now, so a finger or a button's move is taken up from where it left it.
 */
export function createGlide(map: maplibregl.Map) {
  let frame = 0;
  let shown: Shown | null = null;
  let aim: Aim | null = null;
  let track: Track | null = null;
  let cam: CameraAt | null = null;
  let draw: (p: [number, number], heading: number) => void = () => undefined;
  let free: () => boolean = () => false;
  /** The camera goes with the arrow until another move of it (a button) lets go. */
  let withCamera = true;
  let instant = false;
  /** Where the arrow was last drawn. */
  let drawn: { point: [number, number]; heading: number } | null = null;

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const tick = () => {
    frame = 0;
    if (!aim) return;
    const now = performance.now();
    const dt = shown ? Math.max(0, Math.min(0.25, (now - shown.at) / 1000)) : 0;
    shown = instant
      ? { along: aim.along, point: aim.point, heading: aim.bearing ?? shown?.heading ?? 0, at: now }
      : glideStep(shown, aim, now, track);
    // A move too small to see is not drawn: each frame a full render of the map costs battery
    // (walking, the map moves about a pixel a second).
    const px = map.project(shown.point);
    let still = settled(shown, aim, now);
    if (cam && withCamera) {
      // A finger or another move has the map: the camera takes up from there once free.
      if (!free()) still = false;
      else {
        // Within the map's limits, or it would never get there.
        const zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), cam.zoom));
        const pitch = Math.max(map.getMinPitch(), Math.min(map.getMaxPitch(), cam.pitch));
        const kb = instant ? 1 : ease(dt, HEADING_TAU_S);
        const kz = instant ? 1 : ease(dt, CAMERA_TAU_S);
        const [z, p, b] = [map.getZoom(), map.getPitch(), map.getBearing()];
        const next = {
          center: shown.point,
          bearing: turnToward(b, cam.bearing, kb),
          zoom: lerp(z, zoom, kz),
          pitch: lerp(p, pitch, kz),
          padding: cam.padding,
        };
        const centre = map.project(map.getCenter());
        const padded = JSON.stringify(cam.padding) === JSON.stringify(map.getPadding());
        const unseen =
          padded &&
          Math.hypot(px.x - centre.x, px.y - centre.y) < MIN_PX &&
          turned(b, cam.bearing) < 0.1 &&
          Math.abs(zoom - z) < 0.005 &&
          Math.abs(pitch - p) < 0.05;
        if (!unseen) map.jumpTo(next);
        const turn = turned(cam.bearing, map.getBearing());
        still &&=
          turn < 0.1 &&
          Math.abs(zoom - map.getZoom()) < 0.005 &&
          Math.abs(pitch - map.getPitch()) < 0.05;
      }
    }
    // The arrow where it is now, in the view as it is now.
    const at = map.project(shown.point);
    const was = drawn && map.project(drawn.point);
    if (
      !drawn ||
      !was ||
      Math.hypot(at.x - was.x, at.y - was.y) >= MIN_PX ||
      turned(drawn.heading, shown.heading) >= 0.3
    ) {
      draw(shown.point, shown.heading);
      drawn = { point: shown.point, heading: shown.heading };
    }
    if (!still && !instant) frame = requestAnimationFrame(tick);
  };

  return {
    stop,
    /**
     * A new fix: where it puts the arrow (`aim`, its `at` now), the route it runs along, and
     * the camera to follow it to unless `cam` is null or `free()` says a finger or another move
     * has the map. `draw` puts the arrow where it is each frame; `still` (reduced motion) moves
     * everything to the fix at once.
     */
    to(
      next: Omit<Aim, 'at'>,
      tr: Track | null,
      camera: CameraAt | null,
      onDraw: (p: [number, number], heading: number) => void,
      isFree: () => boolean,
      still = false,
    ) {
      // Another route's metres are not this one's.
      if (tr !== track) shown = shown && { ...shown, along: null };
      aim = { ...next, at: performance.now() };
      track = tr;
      cam = camera;
      draw = onDraw;
      free = isFree;
      withCamera = true;
      instant = still;
      drawn = null;
      if (!frame) tick();
    },
    /** The camera is moved otherwise now (a button): the arrow goes on, the camera not. */
    release() {
      withCamera = false;
    },
    /** Guidance ended or the arrow was put elsewhere: start afresh at the next fix. */
    reset() {
      stop();
      drawn = null;
      shown = null;
      aim = null;
    },
  };
}
