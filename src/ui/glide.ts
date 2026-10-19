import type * as maplibregl from 'maplibre-gl';
import { pointAt, type Track } from '../core/nav';

/** Where the arrow is: along the route (metres) when on it, else just a point. */
export interface ArrowAt {
  point: [number, number];
  along: number | null;
}

/** What the camera shows while following: everything but the centre, which is the arrow. */
export interface CameraAt {
  bearing: number;
  zoom: number;
  pitch: number;
  padding: maplibregl.PaddingOptions;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** The short way round the circle. */
const lerpAngle = (a: number, b: number, k: number) =>
  a + (((((b - a) % 360) + 540) % 360) - 180) * k;

/**
 * The arrow and the camera between fixes: a fix comes about once a second, and moving the arrow
 * there at once makes it jump while the camera eases after it. Instead both glide, frame by
 * frame and together, over about the time to the next fix: along the road itself where the
 * arrow is on the route (round its corners, not across them), the camera's centre on it.
 */
export function createGlide(map: maplibregl.Map) {
  let frame = 0;
  let shown: ArrowAt | null = null;
  /** The camera goes with the arrow in this glide; another move of it lets go. */
  let withCamera = true;

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  return {
    /** Where the arrow is drawn now (the last frame), for the next glide to start from. */
    get shown() {
      return shown;
    },
    stop,
    /**
     * Glides the arrow to `to` in `ms`, along `tr` when both ends are on it, and the camera with
     * it to `cam` unless `cam` is null or `free()` says a finger or another move has the map.
     * `draw` puts the arrow where it is each frame.
     */
    to(
      to: ArrowAt,
      ms: number,
      tr: Track | null,
      cam: CameraAt | null,
      draw: (p: [number, number]) => void,
      free: () => boolean,
    ) {
      stop();
      withCamera = true;
      const from = shown ?? to;
      // From where the camera is now, whoever moved it last.
      const fromCam = { bearing: map.getBearing(), zoom: map.getZoom(), pitch: map.getPitch() };
      const onRoad = tr && from.along !== null && to.along !== null;
      const t0 = performance.now();
      const step = () => {
        const k = ms > 0 ? Math.min(1, (performance.now() - t0) / ms) : 1;
        const point: [number, number] = onRoad
          ? pointAt(tr, lerp(from.along!, to.along!, k)).point
          : [lerp(from.point[0], to.point[0], k), lerp(from.point[1], to.point[1], k)];
        shown = { point, along: onRoad ? lerp(from.along!, to.along!, k) : to.along };
        draw(point);
        if (cam && withCamera && free()) {
          map.jumpTo({
            center: point,
            bearing: lerpAngle(fromCam.bearing, cam.bearing, k),
            zoom: lerp(fromCam.zoom, cam.zoom, k),
            pitch: lerp(fromCam.pitch, cam.pitch, k),
            padding: cam.padding,
          });
        }
        frame = k < 1 ? requestAnimationFrame(step) : 0;
      };
      step();
    },
    /** The camera is moved otherwise now (a button): the arrow glides on, the camera not. */
    release() {
      withCamera = false;
    },
    /** Guidance ended or the camera was moved otherwise: start afresh from the map next time. */
    reset() {
      stop();
      shown = null;
    },
  };
}
