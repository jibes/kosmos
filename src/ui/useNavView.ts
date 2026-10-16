import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How guidance looks at the map: following close (each trip starts so), the rest of the way
 * (`overview`), or neither once the user looks around by hand. Refs for the camera code that
 * runs between renders.
 */
export function useNavView() {
  const [following, setFollowing] = useState(true);
  const [overview, setOverview] = useState(false);
  const followingRef = useRef(following);
  const overviewRef = useRef(overview);
  useEffect(() => {
    followingRef.current = following;
    overviewRef.current = overview;
  });
  /** Following close again, as at the start of a trip. */
  const close = useCallback(() => {
    setFollowing(true);
    setOverview(false);
  }, []);
  const showAll = useCallback(() => {
    setFollowing(true);
    setOverview(true);
  }, []);
  /** A gesture: the camera stays where the user put it. */
  const lookAround = useCallback(() => setFollowing(false), []);
  return { following, overview, followingRef, overviewRef, close, showAll, lookAround };
}
