/** The camera, as persisted between sessions. */
export interface View {
  lng: number;
  lat: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

export const VIEW_KEY = 'kosmos.view.v1';

/** First launch: the whole planet, tilted towards Europe and Africa. */
export const DEFAULT_VIEW: View = { lng: 12, lat: 28, zoom: 1.4, bearing: 0, pitch: 0 };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Parses a stored view, returning `null` for anything malformed or out of range. */
export function parseView(raw: string | null): View | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const { lng, lat, zoom, bearing = 0, pitch = 0 } = v as Record<string, unknown>;
  if (![lng, lat, zoom, bearing, pitch].every(finite)) return null;
  const n = { lng, lat, zoom, bearing, pitch } as View;
  if (Math.abs(n.lat) > 90 || Math.abs(n.lng) > 180 || n.zoom < 0 || n.zoom > 24) return null;
  if (n.pitch < 0 || n.pitch > 85) return null;
  return n;
}

export function serializeView(v: View): string {
  const r = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
  return JSON.stringify({
    lng: r(v.lng, 6),
    lat: r(v.lat, 6),
    zoom: r(v.zoom, 2),
    bearing: r(v.bearing, 1),
    pitch: r(v.pitch, 1),
  });
}
