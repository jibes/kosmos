import { tilesAlong } from './alongRoute';
import type { Track } from './nav';
import type { TileId } from './tiles';

/**
 * The map kept on the device: every tile shown, the whole world at low zoom, and the way of a
 * trip once it starts, so guidance goes on without a connection (flight mode, a tunnel, abroad
 * without data). Pure: which tiles, and which go when there are too many.
 */

/** Kept at most, in bytes; the tiles used longest ago go first. */
export const OFFLINE_MAX_BYTES = 300 * 1024 * 1024;
/** The whole world down to this zoom: countries, main roads, cities. */
export const WORLD_MAX_Z = 5;
/** The world is fetched again this often (OpenFreeMap builds anew every week or so). */
export const WORLD_EVERY_MS = 30 * 86_400_000;
/** A tile kept longer than this is fetched again when next shown with a connection. */
export const TILE_STALE_MS = 30 * 86_400_000;

/** Tile URLs name the planet build; kept without it, a tile outlives the next build. */
export const tileKey = (url: string) => url.replace(/\/planet\/[^/]+\//, '/planet/any/');

/** Every tile of the world down to `maxZ`, coarsest first. */
export function worldTiles(maxZ = WORLD_MAX_Z): TileId[] {
  const out: TileId[] = [];
  for (let z = 0; z <= maxZ; z++) {
    const n = 2 ** z;
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) out.push({ z, x, y });
  }
  return out;
}

/**
 * The tiles a trip needs without a connection: the road itself in full detail (zoom 14, the
 * one that holds everything; closer zooms are drawn from it), and coarser bands wider around it
 * for the overview and a look at where it leads. Fewest first, so a short wait already covers
 * the overview.
 */
export function tripTiles(tr: Track): TileId[] {
  const all = Infinity;
  const bands: [z: number, band: number, max: number][] = [
    [8, 40_000, 40],
    [10, 10_000, 80],
    [12, 2_500, 200],
    [14, 400, 900],
  ];
  return bands.flatMap(([z, band, max]) => tilesAlong(tr, 0, { band, reach: all }, max, z));
}

export interface Kept {
  k: string;
  /** Last shown, ms. */
  at: number;
  size: number;
  /** The world: never let go for room. */
  keep?: boolean;
}

/** What goes to fit under `max` bytes: the tiles shown longest ago, never the kept world. */
export function toEvict(entries: Kept[], max = OFFLINE_MAX_BYTES): string[] {
  let total = entries.reduce((n, e) => n + e.size, 0);
  if (total <= max) return [];
  const out: string[] = [];
  for (const e of entries.filter((e) => !e.keep).sort((a, b) => a.at - b.at)) {
    if (total <= max) break;
    total -= e.size;
    out.push(e.k);
  }
  return out;
}

/** The world is due: never fetched, fetched to less zoom, or a month ago. */
export const worldDue = (last: { at: number; z: number } | null, now: number, maxZ = WORLD_MAX_Z) =>
  !last || last.z < maxZ || now - last.at >= WORLD_EVERY_MS;
