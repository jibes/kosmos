import { laneSize, lanesNeeded, laneViews } from '../core/lanes';
import type { NavState } from '../core/nav';
import {
  bannerText,
  formatClock,
  formatDistance,
  formatDuration,
  speedIn,
  speedLabel,
  turnOf,
  type Mode,
  type Route,
} from '../core/route';
import { capital, fill, ordinal, t, units } from '../i18n';
import { LaneIcon, TurnIcon } from './icons';
import { NavBar, ViewToggle } from './NavBar';
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
  /** The rest of the way on screen instead of the view close by. */
  overview: boolean;
  onOverview: () => void;
  /** Asking the router for a new route, or it failed and the old one is followed. */
  reroute: 'idle' | 'asking' | 'failed';
  destination: string;
  onMute: () => void;
  onRecenter: () => void;
  onEnd: () => void;
}

type Step = Route['maneuvers'][number];

/**
 * What the banner shows, short: where the way leads when the signs say ("Towards Tullamore"),
 * as a road's name or number runs both ways; else the street, or the router's sentence. A
 * roundabout leads with its exit ("2nd exit · towards Tullamore").
 */
const short = (m: Step) => {
  if (m.type === ROUNDABOUT && m.exit) {
    return [fill(t.exitNth, { n: ordinal(m.exit) }), m.wayOut ?? m.street]
      .filter(Boolean)
      .join(' · ');
  }
  return m.wayOut ? capital(m.wayOut) : bannerText(m);
};

/** The road itself, under a way shown by where it leads. */
const road = (m: Step) => (m.wayOut && m.street ? m.street : null);

/** Valhalla's maneuver type for entering a roundabout. */
const ROUNDABOUT = 26;

/** A turn this close after the next one is shown with it. */
const THEN_M = 150;

/** Above this (m/s, about 300 km/h) the speed is a GPS jump, not driving. */
const MAX_MS = 83;

/** Turn-by-turn: the next maneuver on top, time and distance left at the bottom. */
export function NavView(props: Props) {
  const { route, mode, nav, lang, muted, following, overview, reroute, destination, ...on } = props;
  const now = useNow(15_000);
  const started = nav.snap !== null;
  const m = route.maneuvers[started ? nav.next : 0];
  // Before the first fix: the way the route sets off, and how far until its first turn.
  const toNext = started ? nav.toNext : route.maneuvers[0]?.distance;
  const eta = started ? nav.eta : route.duration;
  const remaining = started ? nav.remaining : route.distance;
  const speed = speedIn(nav.speed, units);

  // Only while off the route: back on it, guidance carries on whatever the router said.
  const rerouting = nav.offRoute;
  const guiding = !nav.arrived && !rerouting;
  const lanes = guiding && lanesNeeded(m?.lanes) ? m.lanes : undefined;
  const size = lanes && started ? laneSize(nav.toNext, nav.speed, mode) : 'none';

  // Two turns close together: the second one shows under the first, so it is no surprise.
  const after = route.maneuvers[nav.next + 1];
  const then = guiding && m && after && m.distance <= THEN_M ? after : undefined;

  let title = m?.instruction ?? '';
  // On screen the street, where the arrow says the rest; the sentence is for screen readers.
  let shown = m ? short(m) : '';
  let turn = m ? turnOf(m.type) : 'straight';
  // The router's text for the destination is past tense; on the way there it reads ahead.
  if (started && !nav.arrived && m && nav.next === route.maneuvers.length - 1) {
    title = shown = m.alert ?? t.destinationAhead;
  }
  if (nav.arrived) {
    title = shown = t.arrived;
    turn = 'arrive';
  } else if (rerouting) {
    // Not the old route's arrow: while asking it says nothing about where to turn.
    title = shown = reroute === 'failed' ? t.rerouteFailed : t.rerouting;
    turn = reroute === 'failed' ? 'uturn' : 'depart';
  }
  // What the user should know besides the instruction: no position yet, or a poor one.
  const note = !started
    ? t.locating
    : nav.weak && !nav.arrived
      ? t.weakGps
      : guiding && m
        ? road(m)
        : null;

  return (
    <>
      <section
        className="nav-banner"
        data-state={nav.arrived ? 'arrived' : rerouting ? 'rerouting' : 'go'}
      >
        <TurnIcon turn={turn} size={40} />
        <div>
          {guiding && toNext != null && <strong>{formatDistance(toNext, lang, units)}</strong>}
          {/* Only the instruction is announced: the distance changes with every fix. */}
          <p aria-live="polite">
            {shown === title ? (
              title
            ) : (
              <>
                <span aria-hidden="true">{shown}</span>
                <span className="sr-only">{title}</span>
              </>
            )}
          </p>
          {note && <small>{note}</small>}
          {then && (
            <p className="nav-then">
              <span className="nav-then-word">{t.then}</span>
              <TurnIcon turn={turnOf(then.type)} size={18} />
              <span className="nav-then-text">{short(then)}</span>
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

      <ViewToggle
        following={following}
        overview={overview}
        onFollow={on.onRecenter}
        onOverview={on.onOverview}
      />

      {started && !nav.arrived && mode === 'car' && nav.speed <= MAX_MS && (
        <div className="speed surface" role="img" aria-label={`${speed} ${speedLabel(units)}`}>
          <strong>{speed}</strong>
          <small>{speedLabel(units)}</small>
        </div>
      )}

      <NavBar muted={muted} arrived={nav.arrived} onMute={on.onMute} onEnd={on.onEnd}>
        {/* Time left leads; a bare clock time would read as the time now. */}
        {nav.arrived ? (
          <strong>{destination}</strong>
        ) : (
          <>
            <strong>{formatDuration(eta)}</strong>
            <span>
              {fill(t.arriveAt, { time: formatClock(new Date(now + eta * 1000), lang) })} ·{' '}
              {formatDistance(remaining, lang, units)}
            </span>
          </>
        )}
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
