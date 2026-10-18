import * as maplibregl from 'maplibre-gl';
import { metersPerPixel, type LngLat } from '../core/geo';

export function pinMarker(): maplibregl.Marker {
  const el = document.createElement('div');
  el.className = 'pin';
  el.innerHTML = '<span class="pin-dot"></span><span class="pin-shadow"></span>';
  return new maplibregl.Marker({ element: el, anchor: 'bottom' });
}

/** Where a route starts when it is not the user's location. */
export function startMarker(): maplibregl.Marker {
  const el = document.createElement('div');
  el.className = 'start-dot';
  return new maplibregl.Marker({ element: el });
}

/** A stop on the way, by its number in the trip. */
export function stopMarker(n: number): maplibregl.Marker {
  const el = document.createElement('div');
  el.className = 'stop-dot';
  el.textContent = String(n);
  return new maplibregl.Marker({ element: el });
}

/** The user's dot with an accuracy ring sized in ground metres. */
export function userMarker(map: maplibregl.Map) {
  const el = document.createElement('div');
  el.className = 'me';
  el.innerHTML =
    '<span class="me-ring"></span><span class="me-beam"></span><span class="me-dot"></span>' +
    // While navigating: an arrow outlined in white, so it stands out on the route's own blue.
    '<svg class="me-arrow" viewBox="0 0 44 48" aria-hidden="true">' +
    '<path d="M22 4 40 43 22 34 4 43Z"/></svg>';
  const ring = el.firstElementChild as HTMLElement;
  const marker = new maplibregl.Marker({
    element: el,
    pitchAlignment: 'map',
    rotationAlignment: 'map',
  });
  let accuracy = 0;
  let pos: LngLat | null = null;
  let navigating = false;
  let facingDeg: number | null = null;

  const resize = () => {
    if (!pos) return;
    const d = (2 * accuracy) / metersPerPixel(pos.lat, map.getZoom());
    ring.style.width = ring.style.height = `${Math.min(d, 4000)}px`;
    ring.style.opacity = d < 24 ? '0' : '1';
  };
  map.on('zoom', resize);

  return {
    update(fix: LngLat & { accuracy: number }) {
      pos = fix;
      accuracy = fix.accuracy;
      marker.setLngLat([fix.lng, fix.lat]);
      if (!marker.getElement().isConnected) marker.addTo(map);
      resize();
    },
    /** Turns the dot into an arrow along `deg` while navigating; `null` turns it back. */
    heading(deg: number | null) {
      navigating = deg !== null;
      el.classList.toggle('nav', navigating);
      // Lying on a tilted map it shrinks to a wedge; the arrow faces the screen instead.
      marker.setPitchAlignment(navigating ? 'viewport' : 'map');
      marker.setRotation(deg ?? facingDeg ?? 0);
    },
    /** The compass beam: where the phone points, like a torch; `null` hides it. */
    facing(deg: number | null) {
      facingDeg = deg;
      el.classList.toggle('facing', deg !== null);
      if (!navigating) marker.setRotation(deg ?? 0);
    },
    remove() {
      map.off('zoom', resize);
      marker.remove();
    },
  };
}
