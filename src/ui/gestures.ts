import type * as maplibregl from 'maplibre-gl';

const HOLD_MS = 480;
const SLOP_PX = 10;

/**
 * Long-press on touch, right-click with a mouse. MapLibre has no long-press event, and only some
 * browsers turn a held touch into `contextmenu`, so both paths exist and are de-duplicated.
 */
export function onLongPress(map: maplibregl.Map, cb: (at: maplibregl.LngLat) => void): () => void {
  let timer = 0;
  let origin: maplibregl.Point | null = null;
  let firedAt = 0;

  const cancel = () => {
    clearTimeout(timer);
    origin = null;
  };
  const start = (e: maplibregl.MapTouchEvent) => {
    cancel();
    if (e.originalEvent.touches.length !== 1) return;
    origin = e.point;
    const at = e.lngLat;
    timer = window.setTimeout(() => {
      firedAt = Date.now();
      navigator.vibrate?.(12);
      cb(at);
    }, HOLD_MS);
  };
  const move = (e: maplibregl.MapTouchEvent) => {
    if (origin && origin.dist(e.point) > SLOP_PX) cancel();
  };
  const context = (e: maplibregl.MapMouseEvent) => {
    e.preventDefault();
    if (Date.now() - firedAt > 1000) cb(e.lngLat);
  };

  map.on('touchstart', start);
  map.on('touchmove', move);
  map.on('touchend', cancel);
  map.on('touchcancel', cancel);
  map.on('movestart', cancel);
  map.on('contextmenu', context);
  return () => {
    cancel();
    map.off('touchstart', start);
    map.off('touchmove', move);
    map.off('touchend', cancel);
    map.off('touchcancel', cancel);
    map.off('movestart', cancel);
    map.off('contextmenu', context);
  };
}
