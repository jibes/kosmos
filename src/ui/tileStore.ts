import * as maplibregl from 'maplibre-gl';
import { OFFLINE_MAX_BYTES, TILE_STALE_MS, tileKey, toEvict, type Kept } from '../core/offline';
import { logEvent } from './usageLog';

/**
 * The map kept on the device (`core/offline.ts`): MapLibre asks for its tiles, its TileJSON
 * and its fonts through a protocol of the app's own (`kosmos://`), which answers from
 * IndexedDB first and from the network otherwise, keeping what comes. The same in the browser
 * and the Android app, which has no service worker.
 */

const HOST = 'https://tiles.openfreemap.org';
const SCHEME = 'kosmos';
const DB = 'kosmos-tiles';
/** A TileJSON this old is asked again first; offline the kept one serves. */
const SOURCE_MS = 4000;

let db: Promise<IDBDatabase> | null = null;
const open = () =>
  (db ??= new Promise((done, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('data');
      req.result.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => {
      const d = req.result;
      // Closed under it (site data cleared, storage pressure): opened anew on the next ask.
      d.onclose = d.onversionchange = () => {
        d.close();
        db = null;
      };
      done(d);
    };
    req.onerror = () => {
      db = null;
      fail(req.error);
    };
  }));

const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((ok, fail) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });

interface Meta extends Kept {
  /** When it came from the network. */
  got: number;
}

async function read(k: string): Promise<{ data: ArrayBuffer; meta: Meta } | null> {
  const d = await open();
  const tx = d.transaction(['data', 'meta'], 'readonly');
  const [data, meta] = await Promise.all([
    done(tx.objectStore('data').get(k) as IDBRequest<ArrayBuffer | undefined>),
    done(tx.objectStore('meta').get(k) as IDBRequest<Meta | undefined>),
  ]);
  return data && meta ? { data, meta } : null;
}

/** The kept total, known after the first look, so room is made without a scan each time. */
let total: number | null = null;

/** `got`: when it came from the network; only the keep flag changing leaves it as it was. */
async function write(k: string, data: ArrayBuffer, keep: boolean, got = Date.now()) {
  const d = await open();
  const now = Date.now();
  const tx = d.transaction(['data', 'meta'], 'readwrite');
  tx.objectStore('data').put(data, k);
  const old = await done(tx.objectStore('meta').get(k) as IDBRequest<Meta | undefined>);
  const meta: Meta = { k, at: now, got, size: data.byteLength, keep: keep || old?.keep };
  tx.objectStore('meta').put(meta);
  if (total !== null) total += data.byteLength - (old?.size ?? 0);
  if (total === null || total > OFFLINE_MAX_BYTES) void makeRoom();
}

/** Shown again: kept longer. Written at most once a day, as it is shown all the time. */
async function touch(meta: Meta) {
  if (Date.now() - meta.at < 86_400_000) return;
  const d = await open();
  d.transaction('meta', 'readwrite')
    .objectStore('meta')
    .put({ ...meta, at: Date.now() });
}

let tidying = false;
async function makeRoom() {
  if (tidying) return;
  tidying = true;
  try {
    const d = await open();
    const all = await done(
      d.transaction('meta').objectStore('meta').getAll() as IDBRequest<Meta[]>,
    );
    total = all.reduce((n, m) => n + m.size, 0);
    if (total <= OFFLINE_MAX_BYTES) return;
    // Down to 90 %, so the next tiles shown do not each start another scan of them all.
    const gone = new Set(toEvict(all, OFFLINE_MAX_BYTES * 0.9));
    if (!gone.size) return;
    const tx = d.transaction(['data', 'meta'], 'readwrite');
    for (const k of gone) {
      tx.objectStore('data').delete(k);
      tx.objectStore('meta').delete(k);
    }
    const freed = all.filter((m) => gone.has(m.k)).reduce((n, m) => n + m.size, 0);
    total -= freed;
    logEvent('tiles.evict', { n: gone.size });
  } finally {
    tidying = false;
  }
}

/**
 * Lets go of every area viewed and every trip kept, never the world; for About's button.
 * Says how many bytes that freed.
 */
export async function clearViewed(): Promise<number> {
  const d = await open();
  const all = await done(d.transaction('meta').objectStore('meta').getAll() as IDBRequest<Meta[]>);
  const gone = all.filter((m) => !m.keep);
  const tx = d.transaction(['data', 'meta'], 'readwrite');
  for (const m of gone) {
    tx.objectStore('data').delete(m.k);
    tx.objectStore('meta').delete(m.k);
  }
  await new Promise<void>((ok, fail) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => fail(tx.error);
  });
  const freed = gone.reduce((n, m) => n + m.size, 0);
  total = all.reduce((n, m) => n + m.size, 0) - freed;
  logEvent('tiles.clear', { n: gone.length });
  return freed;
}

/** How much is kept, for the About sheet. */
export async function keptBytes(): Promise<number> {
  if (total === null) await makeRoom();
  return total ?? 0;
}

/**
 * A tile (or a font range) by its URL: kept, else from the network and kept; a stale one is
 * shown and fetched anew behind. `keep` holds it through any lack of room (the world).
 * `fresh` (fetching for later) waits for a stale one's new copy instead, so a download of
 * many keeps to its own pace and can be stopped.
 */
export async function storedFetch(url: string, keep = false, signal?: AbortSignal, fresh = false) {
  const k = tileKey(url);
  const hit = await read(k).catch(() => null);
  if (hit) {
    void touch(hit.meta).catch(() => undefined);
    const stale = Date.now() - hit.meta.got > TILE_STALE_MS && navigator.onLine;
    if (stale && fresh) {
      const data = await network(url, signal).catch(() => null);
      if (data) {
        await write(k, data, keep).catch(() => undefined);
        return data;
      }
    }
    if (keep && !hit.meta.keep) {
      void write(k, hit.data, true, hit.meta.got).catch(() => undefined);
    }
    if (stale && !fresh) {
      void network(url)
        .then((data) => write(k, data, keep))
        .catch(() => undefined);
    }
    return hit.data;
  }
  const data = await network(url, signal);
  void write(k, data, keep).catch(() => undefined);
  return data;
}

async function network(url: string, signal?: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(String(res.status));
  return res.arrayBuffer();
}

/** Kept already (prefetching skips it). */
export async function isKept(url: string) {
  const d = await open();
  const n = await done(d.transaction('meta').objectStore('meta').count(tileKey(url)));
  return n > 0;
}

/**
 * The TileJSON: asked first; the kept one offline or when the network is slow. With none kept,
 * the network is waited for however long it takes, or a slow first start had no map at all.
 */
async function source(url: string, signal: AbortSignal) {
  const k = `source|${url}`;
  const asked = network(url, signal).then((data) => {
    void write(k, data, true).catch(() => undefined);
    return data;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((ok) => (timer = setTimeout(() => ok(null), SOURCE_MS)));
  try {
    const first = await Promise.race([asked, late]);
    if (first) return first;
  } catch {
    // Offline or refused: the kept one, below.
  } finally {
    clearTimeout(timer);
  }
  const hit = await read(k).catch(() => null);
  if (hit) {
    asked.catch(() => undefined);
    return hit.data;
  }
  return asked;
}

/**
 * The map's requests to OpenFreeMap through the store: set as the map's `transformRequest`,
 * with the protocol registered once.
 */
export function storeRequests(url: string, type?: maplibregl.ResourceType) {
  if (!url.startsWith(HOST)) return { url };
  if (type === 'Tile' || type === 'Glyphs' || type === 'Source') {
    return { url: `${SCHEME}://${type.toLowerCase()}/${encodeURIComponent(url)}` };
  }
  return { url };
}

let registered = false;
export function registerTileStore() {
  if (registered || typeof indexedDB === 'undefined') return;
  registered = true;
  // The service worker kept tiles itself before this store: given back.
  if (typeof caches !== 'undefined') {
    for (const name of ['kosmos-tiles-v1', 'kosmos-tilejson-v1']) void caches.delete(name);
  }
  maplibregl.addProtocol(SCHEME, async (params, abort) => {
    const [, kind, raw] = /^kosmos:\/\/(\w+)\/(.*)$/.exec(params.url) ?? [];
    const url = decodeURIComponent(raw ?? '');
    if (kind === 'source') {
      const data = await source(url, abort.signal);
      return { data: JSON.parse(new TextDecoder().decode(data)) };
    }
    return { data: await storedFetch(url, false, abort.signal) };
  });
}

/**
 * Many tiles fetched for later (the world, a trip), a few at a time, each kept one skipped.
 * Ends early when `stop` says so (guidance ended, the network gone); says how many came.
 */
export async function prefetch(
  urls: string[],
  o: {
    keep?: boolean;
    at?: number;
    stop?: () => boolean;
    /** How many are done (kept, fetched or missing), now and then. */
    progress?: (done: number, total: number) => void;
  } = {},
): Promise<number> {
  let got = 0;
  let i = 0;
  let handled = 0;
  let told = 0;
  const tell = () => {
    handled++;
    // Not for every tile: a few times a second at most is plenty to watch.
    if (o.progress && (handled === urls.length || Date.now() - told > 250)) {
      told = Date.now();
      o.progress(handled, urls.length);
    }
  };
  const worker = async () => {
    while (i < urls.length && !o.stop?.()) {
      const url = urls[i++];
      try {
        if (o.keep || !(await isKept(url))) {
          await storedFetch(url, o.keep, undefined, true);
          got++;
        }
      } catch {
        // Missing (an empty sea tile) or the network gone: the next one.
      }
      tell();
    }
  };
  await Promise.all(Array.from({ length: o.at ?? 4 }, worker));
  return got;
}
