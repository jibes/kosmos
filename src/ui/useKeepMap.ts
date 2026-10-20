import { useEffect, useRef } from 'react';
import { track } from '../core/nav';
import { tripTiles, worldDue, worldTiles, WORLD_MAX_Z } from '../core/offline';
import type { Mode, Route } from '../core/route';
import { tileUrl } from '../core/tiles';
import { tilesTemplate } from './categorySearch';
import { isNative } from './native';
import { store, stored, WORLD_KEY, WORLD_TEST_KEY } from './prefs';
import { setFetching } from './offlineState';
import { prefetch } from './tileStore';
import { logEvent } from './usageLog';

/** After opening, the world waits this long, so the map in view comes first. */
const WORLD_AFTER_MS = 20_000;

export const lastWorld = (): { at: number; z: number } | null => {
  try {
    const v = JSON.parse(stored(WORLD_KEY) ?? 'null');
    return v && typeof v.at === 'number' && typeof v.z === 'number' ? v : null;
  } catch {
    return null;
  }
};

type Connection = EventTarget & { type?: string; saveData?: boolean };
const connection = () => (navigator as Navigator & { connection?: Connection }).connection;

/**
 * May the world be fetched now, and to which zoom: on Wi-Fi (or a wired computer), never
 * saving data; an automated browser only when a test asks.
 */
function worldZoom(): number | null {
  const c = connection();
  if (c?.saveData) return null;
  if (navigator.webdriver) {
    const asked = stored(WORLD_TEST_KEY);
    const z = asked === null ? NaN : Number(asked);
    return Number.isInteger(z) && z >= 0 ? z : null;
  }
  if (c?.type) return c.type === 'wifi' || c.type === 'ethernet' ? WORLD_MAX_Z : null;
  // Not told: a phone could be on mobile data, a computer hardly.
  return !isNative && !matchMedia('(pointer: coarse)').matches ? WORLD_MAX_Z : null;
}

/**
 * The map kept for when there is no connection (`core/offline.ts`): the whole world at low
 * zoom, now and then on Wi-Fi; and the way of each trip as it starts (About shows both).
 */
export function useKeepMap(route: Route | undefined, mode: Mode, navigating: boolean) {
  useEffect(() => {
    let id = 0;
    let running = false;
    let wait = 2000;
    const run = async () => {
      clearTimeout(id);
      const z = worldZoom();
      if (running || z === null || !worldDue(lastWorld(), Date.now(), z)) return;
      const template = tilesTemplate();
      // The map's tiles not known yet (slow to open, offline at first): later, less often.
      if (!template) {
        id = window.setTimeout(run, wait);
        wait = Math.min(wait * 2, 120_000);
        return;
      }
      running = true;
      let stopped = false;
      const got = await prefetch(
        worldTiles(z).map((tile) => tileUrl(template, tile)),
        {
          keep: true,
          at: 2,
          // Off Wi-Fi (out of the house) or offline: stopped, to go on another time.
          stop: () => (stopped ||= !navigator.onLine || worldZoom() === null),
          progress: (done, total) => setFetching('world', { done, total }),
        },
      );
      running = false;
      setFetching('world', null);
      if (!stopped) {
        store(WORLD_KEY, JSON.stringify({ at: Date.now(), z }));
        // Asked once kept: else the browser may drop the store when space runs low.
        void navigator.storage?.persist?.().catch(() => undefined);
      }
      logEvent('tiles.world', { z, got, done: !stopped });
    };
    // An automated browser that asked (`worldZoom`) need not wait.
    id = window.setTimeout(run, navigator.webdriver ? 500 : WORLD_AFTER_MS);
    // Opened on mobile data: Wi-Fi coming later (or the connection back) starts it then.
    const later = () => {
      clearTimeout(id);
      id = window.setTimeout(run, 5000);
    };
    const c = connection();
    window.addEventListener('online', later);
    c?.addEventListener?.('change', later);
    return () => {
      clearTimeout(id);
      window.removeEventListener('online', later);
      c?.removeEventListener?.('change', later);
    };
  }, []);

  const guiding = useRef(navigating);
  useEffect(() => {
    guiding.current = navigating;
  });
  useEffect(() => {
    const template = tilesTemplate();
    // Saving data: the trip's tiles are hundreds; only what is shown is kept then.
    if (!navigating || !route || !template || connection()?.saveData) return;
    let live = true;
    const urls = tripTiles(track(route, mode)).map((tile) => tileUrl(template, tile));
    void prefetch(urls, {
      stop: () => !live || !guiding.current || !navigator.onLine,
      progress: (done, total) => setFetching('trip', { done, total }),
    }).then((got) => {
      setFetching('trip', null);
      if (live && navigator.onLine) logEvent('tiles.trip', { n: urls.length, got });
    });
    return () => {
      live = false;
      setFetching('trip', null);
    };
  }, [navigating, route, mode]);
}
