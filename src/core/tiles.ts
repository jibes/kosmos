import type { LngLat } from './geo';

/**
 * Which vector tiles cover a view. The schema puts every place into the tiles of zoom 14 only;
 * lower zooms keep the most important ones. A category search reads zoom 14 for any view.
 */

export const DETAIL_ZOOM = 14;

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface TileId {
  z: number;
  x: number;
  y: number;
}

const tx = (lng: number, n: number) => ((lng + 180) / 360) * n;
const ty = (lat: number, n: number) => {
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
};

/**
 * The tiles of zoom `z` over `b`, those nearest `center` first, at most `max`: a wide view reads
 * its middle rather than hundreds of tiles.
 */
export function tilesIn(b: Bounds, center: LngLat, z = DETAIL_ZOOM, max = 48): TileId[] {
  const n = 2 ** z;
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v)));
  const [x0, x1] = [clamp(tx(b.west, n)), clamp(tx(b.east, n))];
  const [y0, y1] = [clamp(ty(b.north, n)), clamp(ty(b.south, n))];
  const cx = tx(center.lng, n);
  const cy = ty(center.lat, n);
  const out: (TileId & { d: number })[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) out.push({ z, x, y, d: Math.hypot(x + 0.5 - cx, y + 0.5 - cy) });
  }
  return out
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map(({ z, x, y }) => ({ z, x, y }));
}

/** A tile's URL from a TileJSON template. */
export const tileUrl = (template: string, { z, x, y }: TileId) =>
  template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

/** A point inside a tile (0 … extent from its north-west corner) on the globe. */
export function tilePoint({ z, x, y }: TileId, px: number, py: number, extent: number): LngLat {
  const n = 2 ** z;
  const fx = (x + px / extent) / n;
  const fy = (y + py / extent) / n;
  return {
    lng: fx * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * fy))) * 180) / Math.PI,
  };
}
