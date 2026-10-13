export interface LngLat {
  lng: number;
  lat: number;
}

const EARTH_CIRCUMFERENCE = 40075016.686;

/** Ground metres covered by one CSS pixel at a latitude, for MapLibre's 512px tiles. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** `52.52000° N, 13.40500° E`; five decimals is about one metre. */
export function formatLngLat({ lng, lat }: LngLat, digits = 5): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(digits)}° ${ns}, ${Math.abs(lng).toFixed(digits)}° ${ew}`;
}

/** Plain `lat, lng` for pasting into other apps. */
export function plainLngLat({ lng, lat }: LngLat, digits = 6): string {
  return `${lat.toFixed(digits)}, ${lng.toFixed(digits)}`;
}

/** Wraps any longitude into [-180, 180). */
export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function osmUrl({ lng, lat }: LngLat, zoom = 17): string {
  const la = lat.toFixed(6);
  const lo = lng.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=${Math.round(zoom)}/${la}/${lo}`;
}

/** Android hands a `geo:` URI to whichever maps or navigation app the user picks. */
export function geoUri({ lng, lat }: LngLat, label?: string): string {
  const ll = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  return `geo:${ll}?q=${ll}${label ? `(${encodeURIComponent(label)})` : ''}`;
}

export function directionsUrl({ lng, lat }: LngLat): string {
  return `https://www.openstreetmap.org/directions?route=%3B${lat.toFixed(6)}%2C${lng.toFixed(6)}`;
}

/** Great-circle distance in metres. */
export function distance(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}
