import { useCallback, useEffect, useRef, useState } from 'react';

/** The user's own zoom and tilt while following, kept for the rest of the trip. */
export interface Adjust {
  /** Zoom levels added to the automatic zoom for the way of travel and speed. */
  zoomBy: number;
  /** Tilt in degrees, or the way of travel's own when `null`. */
  pitch: number | null;
}

/**
 * How guidance looks at the map, besides following (the location button's `Follow`, as on
 * the map): the rest of the way (`overview`), and the user's own zoom and tilt, which never
 * stop following. Refs for the camera code that runs between renders.
 */
export function useNavView() {
  const [overview, setOverviewState] = useState(false);
  const overviewRef = useRef(overview);
  useEffect(() => {
    overviewRef.current = overview;
  });
  const adjustRef = useRef<Adjust>({ zoomBy: 0, pitch: null });
  /** A pinch or tilt by hand since the camera last moved: read off the map at the next fix. */
  const lookedRef = useRef(false);
  const setOverview = useCallback((on: boolean) => {
    overviewRef.current = on;
    setOverviewState(on);
  }, []);
  /** Each trip starts close behind the user, at the way of travel's own zoom and tilt. */
  const reset = useCallback(() => {
    setOverview(false);
    adjustRef.current = { zoomBy: 0, pitch: null };
    lookedRef.current = false;
  }, [setOverview]);
  /** A pinch or tilt by hand. */
  const looked = useCallback(() => {
    lookedRef.current = true;
  }, []);
  /** Flat again, as the needle leaves it. */
  const level = useCallback(() => {
    adjustRef.current = { ...adjustRef.current, pitch: 0 };
  }, []);
  return { overview, overviewRef, setOverview, adjustRef, lookedRef, reset, looked, level };
}
