import { useEffect, useState } from 'react';
import { junctionsOf, type Junction } from '../core/junction';
import type { Mode, Route } from '../core/route';
import { LIMITS_URL, lengthOf, limitsBody, parseLimits, type Limits } from '../core/speedLimit';
import { getJson } from './http';

interface Trace {
  /** By car only. */
  limits: Limits | null;
  /** Each maneuver's junction, by its index. */
  junctions: Map<number, Junction>;
}

const NONE: Trace = { limits: null, junctions: new Map() };

/**
 * The speed limits and the shape of each junction along the route being followed: one request
 * for each route guided (a reroute brings a new one), none on the route card, never repeated
 * for the same route.
 */
export function useRouteTrace(route: Route | undefined, mode: Mode): Trace {
  const [got, setGot] = useState<{ route: Route; trace: Trace } | null>(null);
  useEffect(() => {
    if (!route) return;
    const ctrl = new AbortController();
    getJson(LIMITS_URL, ctrl.signal, limitsBody(route.coords, mode))
      .then((r) => {
        if (ctrl.signal.aborted || !r.ok) return;
        setGot({
          route,
          trace: {
            limits: mode === 'car' ? parseLimits(r.json, lengthOf(route.coords)) : null,
            junctions: junctionsOf(r.json, route, mode),
          },
        });
      })
      // Without it guidance goes on as before: no sign, the plain arrows.
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [route, mode]);
  return got && got.route === route ? got.trace : NONE;
}
