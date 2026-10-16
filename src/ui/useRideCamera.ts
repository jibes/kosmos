import type * as maplibregl from 'maplibre-gl';
import { useEffect, type RefObject } from 'react';
import { tripRest } from '../core/navView';
import type { RideState } from '../core/ride';
import type { Transit } from '../core/transit';
import { fitNav } from './layout';
import { motion } from './motion';

interface Options {
  map: maplibregl.Map | null;
  ride: { transit: Transit; st: RideState } | null;
  /** The user has not looked around since (or asked to follow again). */
  following: boolean;
  overview: boolean;
  touchingRef: RefObject<Set<number>>;
}

/**
 * The camera on public transport, north up and from above: walking to a stop or waiting, on
 * the user; on board, the rest of the line to the stop to get off at; the overview, the rest
 * of the trip. Moves on every step of the ride (each fix, and every few seconds underground).
 */
export function useRideCamera({ map, ride, following, overview, touchingRef }: Options) {
  useEffect(() => {
    if (!map || !ride || !following || touchingRef.current.size) return;
    const { transit, st } = ride;
    const at: [number, number] | null = st.fix ? [st.fix.lng, st.fix.lat] : null;
    if (overview || st.phase === 'ride') {
      fitNav(map, tripRest(transit, st, at, overview), motion(1000));
    } else if (at) {
      map.easeTo({ center: at, bearing: 0, pitch: 0, duration: motion(800) });
    }
  }, [map, ride, following, overview, touchingRef]);
}
