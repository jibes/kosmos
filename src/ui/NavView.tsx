import { laneSize, lanesNeeded, laneViews } from '../core/lanes';
import type { NavState } from '../core/nav';
import {
  formatClock,
  formatDistance,
  formatDuration,
  speedIn,
  speedLabel,
  turnOf,
  type Mode,
  type Route,
} from '../core/route';
import { t, units } from '../i18n';
import { LaneIcon, LocateIcon, TurnIcon } from './icons';
import { NavBar } from './NavBar';
import type { RouteStatus } from './RouteCard';
import type { LocationStatus } from './useLocation';
import { useNow } from './useNow';

interface Props {
  route: Route;
  mode: Mode;
  nav: NavState;
  lang: string;
  muted: boolean;
  following: boolean;
  /** Asking the router for a new route, or it failed and the old one is followed. */
  reroute: 'idle' | 'asking' | 'failed';
  onMute: () => void;
  onRecenter: () => void;
  onEnd: () => void;
}

/** A turn this close after the next one is shown with it. */
const THEN_M = 150;

/** Above this (m/s, about 300 km/h) the speed is a GPS jump, not driving. */
const MAX_MS = 83;

/** Turn-by-turn: the next maneuver on top, time and distance left at the bottom. */
export function NavView({ route, mode, nav, lang, muted, following, reroute, ...on }: Props) {
  const now = useNow(15_000);
  const started = nav.snap !== null;
  const m = route.maneuvers[started ? nav.next : 0];
  const eta = started ? nav.eta : route.duration;
  const remaining = started ? nav.remaining : route.distance;
  const speed = speedIn(nav.speed, units);

  // Only while off the route: back on it, guidance carries on whatever the router said.
  const rerouting = nav.offRoute;
  const guiding = started && !nav.arrived && !rerouting;
  const lanes = guiding && lanesNeeded(m?.lanes) ? m.lanes : undefined;
  const size = lanes ? laneSize(nav.toNext, nav.speed, mode) : 'none';

  // Two turns close together: the second one shows under the first, so it is no surprise.
  const after = route.maneuvers[nav.next + 1];
  const then = guiding && m && after && m.distance <= THEN_M ? after : undefined;

  let title = m?.instruction ?? '';
  let turn = m ? turnOf(m.type) : 'straight';
  // The router's text for the destination is past tense; on the way there it reads ahead.
  if (started && !nav.arrived && m && nav.next === route.maneuvers.length - 1) {
    title = m.alert ?? t.destinationAhead;
  }
  if (nav.arrived) {
    title = t.arrived;
    turn = 'arrive';
  } else if (rerouting) {
    title = reroute === 'failed' ? t.rerouteFailed : t.rerouting;
  }

  return (
    <>
      <section
        className="nav-banner"
        data-state={nav.arrived ? 'arrived' : rerouting ? 'rerouting' : 'go'}
      >
        <TurnIcon turn={turn} size={40} />
        <div>
          {guiding && <strong>{formatDistance(nav.toNext, lang, units)}</strong>}
          {/* Only the instruction is announced: the distance changes with every fix. */}
          <p aria-live="polite">{title}</p>
          {then && (
            <p className="nav-then">
              {t.then}
              <TurnIcon turn={turnOf(then.type)} size={18} />
              <span>{then.instruction}</span>
            </p>
          )}
        </div>
        {lanes && size !== 'none' && (
          <div className="nav-lanes" data-size={size} role="img" aria-label={t.lanes}>
            {laneViews(lanes).map((lane, i) => (
              <span key={i} data-use={lane.use}>
                <LaneIcon lane={lane} size={size === 'big' ? 40 : 24} />
              </span>
            ))}
          </div>
        )}
      </section>

      {!following && (
        <button type="button" className="recenter surface" onClick={on.onRecenter}>
          <LocateIcon filled />
          {t.recenter}
        </button>
      )}

      {started && !nav.arrived && mode === 'car' && nav.speed <= MAX_MS && (
        <div className="speed surface" role="img" aria-label={`${speed} ${speedLabel(units)}`}>
          <strong>{speed}</strong>
          <small>{speedLabel(units)}</small>
        </div>
      )}

      <NavBar muted={muted} arrived={nav.arrived} onMute={on.onMute} onEnd={on.onEnd}>
        <strong>{formatClock(new Date(now + eta * 1000), lang)}</strong>
        <span>
          {formatDuration(eta)} · {formatDistance(remaining, lang, units)}
        </span>
      </NavBar>
    </>
  );
}

interface WaitingProps {
  status: RouteStatus;
  location: LocationStatus;
  destination: string;
  muted: boolean;
  onMute: () => void;
  onRetry: () => void;
  onEnd: () => void;
}

/**
 * Guidance without a route yet: it starts from here (a start chosen elsewhere, a new
 * connection), and that route is still on its way, cannot come without a position, or failed.
 * End stays reachable whatever happens.
 */
export function NavWaiting({ status, location, destination, ...on }: WaitingProps) {
  const noFix = status === 'locating' && (location === 'denied' || location === 'unavailable');
  const text = noFix
    ? location === 'denied'
      ? t.locationDenied
      : t.noLocation
    : status === 'locating'
      ? t.locating
      : status === 'busy'
        ? t.routeBusy
        : status === 'failed'
          ? t.routeFailed
          : status === 'none'
            ? t.noRoute
            : t.routing;
  const stuck = noFix || status === 'busy' || status === 'failed' || status === 'none';
  return (
    <>
      <section className="nav-banner" data-state={stuck ? 'rerouting' : 'go'}>
        <TurnIcon turn="depart" size={40} />
        <div>
          <p aria-live="polite">{text}</p>
        </div>
        {(status === 'busy' || status === 'failed') && (
          <button type="button" className="ride-new" onClick={on.onRetry}>
            {t.retry}
          </button>
        )}
      </section>
      <NavBar muted={on.muted} arrived={false} onMute={on.onMute} onEnd={on.onEnd}>
        <span>{destination}</span>
      </NavBar>
    </>
  );
}
