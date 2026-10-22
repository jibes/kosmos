import { isAway } from './native';
import type * as maplibregl from 'maplibre-gl';
import { useEffect, useRef, type RefObject } from 'react';
import { tripRest } from '../core/navView';
import type { RideState } from '../core/ride';
import type { Transit } from '../core/transit';
import type { Follow } from './Controls';
import { fitNav } from './layout';
import { nearCentre } from './useFixCamera';
import { motion } from './motion';

interface Options {
  map: maplibregl.Map | null;
  ride: { transit: Transit; st: RideState } | null;
  /** The location button: free, following with the map's rotation, or turned by the compass. */
  follow: Follow;
  overview: boolean;
  touchingRef: RefObject<Set<number>>;
}

/**
 * The camera on public transport, from above: walking to a stop or waiting, on the user, turned
 * as the location button says (the compass turns it itself, `useCompassFollow`); on board, the
 * rest of the line to the stop to get off at; the overview, the rest of the trip, north up.
 * Moves with each fix, and underground as the stops pass; not on the ride's ticks alone.
 */
export function useRideCamera({ map, ride, follow, overview, touchingRef }: Options) {
  const rideRef = useRef(ride);
  useEffect(() => {
    rideRef.current = ride;
  });
  // Moved by what moves it: the ride ticks every few seconds with nothing new, and each move
  // is a second of full renders.
  const transit = ride?.transit;
  const fix = ride?.st.fix;
  const phase = ride?.st.phase;
  const leg = ride?.st.leg;
  const stopsLeft = ride?.st.stopsLeft;
  useEffect(() => {
    const ride = rideRef.current;
    // Out of sight a camera move is a full render for nobody; the next step after puts it right.
    if (!map || !ride || touchingRef.current.size || isAway()) return;
    if (!overview && follow === 'off') return;
    const { transit, st } = ride;
    const at: [number, number] | null = st.fix ? [st.fix.lng, st.fix.lat] : null;
    const turned = !overview && follow === 'compass';
    if (overview || st.phase === 'ride') {
      const rest = tripRest(transit, st, at, overview);
      fitNav(map, rest, motion(1000), turned ? map.getBearing() : 0);
    } else if (at) {
      // Standing still: GPS jitter would ease the map, rendering, every second.
      if (nearCentre(map, { lng: at[0], lat: at[1] })) return;
      // An ease would stop the compass turning the map every frame: the centre jumps instead.
      if (turned) {
        if (!map.isMoving()) map.jumpTo({ center: at });
      } else map.easeTo({ center: at, duration: motion(800) });
    }
  }, [map, transit, fix, phase, leg, stopsLeft, follow, overview, touchingRef]);
}
