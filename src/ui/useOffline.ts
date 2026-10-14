import type * as maplibregl from 'maplibre-gl';
import { useEffect, useState } from 'react';

/** Tile failures this close together mean the map cannot load, not one bad tile. */
const ERRORS = 3;
const WITHIN_MS = 10_000;

/**
 * The map has no connection: the browser says so, or tiles keep failing. A tile that loads
 * again (from the network or the offline cache) clears it.
 */
export function useOffline(map: maplibregl.Map | null) {
  const [offline, setOffline] = useState(() => navigator.onLine === false);
  useEffect(() => {
    const online = () => setOffline(false);
    const lost = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', lost);
    let errors: number[] = [];
    const onError = (ev: maplibregl.ErrorEvent) => {
      const e = ev as maplibregl.ErrorEvent & { tile?: unknown; sourceId?: string };
      if (!e.tile && !e.sourceId) return;
      const now = Date.now();
      errors = [...errors.filter((at) => now - at < WITHIN_MS), now];
      if (errors.length >= ERRORS) setOffline(true);
    };
    const onData = (e: maplibregl.MapSourceDataEvent) => {
      if (!e.tile || navigator.onLine === false) return;
      errors = [];
      setOffline(false);
    };
    map?.on('error', onError);
    map?.on('sourcedata', onData);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', lost);
      map?.off('error', onError);
      map?.off('sourcedata', onData);
    };
  }, [map]);
  return offline;
}
