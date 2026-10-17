import { useEffect, useState } from 'react';
import type { Route } from '../core/route';
import { LIMITS_URL, lengthOf, limitsBody, parseLimits, type Limits } from '../core/speedLimit';
import { getJson } from './http';

/**
 * The speed limits along the route being driven: one request for each route followed (a reroute
 * brings a new one), none on the route card, never repeated for the same route.
 */
export function useSpeedLimits(route: Route | undefined): Limits | null {
  const [got, setGot] = useState<{ route: Route; limits: Limits | null } | null>(null);
  useEffect(() => {
    if (!route) return;
    const ctrl = new AbortController();
    getJson(LIMITS_URL, ctrl.signal, limitsBody(route.coords))
      .then((r) => {
        if (ctrl.signal.aborted) return;
        setGot({ route, limits: r.ok ? parseLimits(r.json, lengthOf(route.coords)) : null });
      })
      // Without limits guidance goes on as before: the sign just does not show.
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [route]);
  return got && got.route === route ? got.limits : null;
}
