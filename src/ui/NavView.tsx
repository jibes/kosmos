import { laneSize, lanesNeeded, laneViews } from '../core/lanes';
import { headingToRoute, type NavState } from '../core/nav';
import {
  bannerText,
  roadOf,
  formatClock,
  formatDistance,
  formatDuration,
  speedIn,
  speedLabel,
  turnOf,
  type Mode,
  type Route,
} from '../core/route';
import { stepsAhead } from '../core/navView';
import { limitAt, limitIn, overLimit } from '../core/speedLimit';
import { capital, fill, ordinal, t, units } from '../i18n';
import { LaneIcon, TurnIcon } from './icons';
import { NavBar } from './NavBar';
import { TripDetails } from './TripDetails';
import type { RouteStatus } from './RouteCard';
import type { LocationStatus } from './useLocation';
import { useNavNotice } from './useNavNotice';
import { useNow } from './useNow';
import { useSpeedLimits } from './useSpeedLimits';

interface Props {
  route: Route;
  mode: Mode;
  nav: NavState;
  lang: string;
  muted: boolean;
  /** Asking the router for a new route, or it failed and the old one is followed. */
  reroute: 'idle' | 'asking' | 'failed';
  destination: string;
  onMute: () => void;
  onEnd: () => void;
  /** The steps ahead, open under the banner (a tap on it; Back closes them). */
  open: boolean;
  onOpen: (open: boolean) => void;
}

type Step = Route['maneuvers'][number];

/**
 * What the banner shows, short: where the way leads when the signs say ("Towards Tullamore"),
 * as a road's name or number runs both ways; else the street, or the router's sentence. A
 * roundabout leads with its exit ("2nd exit · towards Tullamore").
 */
const short = (m: Step) => {
  if (m.type === ROUNDABOUT && m.exit) {
    return [fill(t.exitNth, { n: ordinal(m.exit) }), m.wayOut ?? roadOf(m)]
      .filter(Boolean)
      .join(' · ');
  }
  return m.wayOut ? capital(m.wayOut) : bannerText(m);
};

/** The road itself, under a way shown by where it leads. */
const road = (m: Step) => (m.wayOut ? (roadOf(m) ?? null) : null);

interface StepsProps {
  route: Route;
  /** The first step after the one in the banner. */
  from: number;
  /** Metres to the step in the banner. */
  toNext: number;
  lang: string;
  destination: string;
}

/** The steps after the one in the banner, each with how far it is from here. */
function Steps({ route, from, toNext, lang, destination }: StepsProps) {
  const ms = route.maneuvers;
  const at = stepsAhead(
    ms.map((m) => m.distance),
    from,
    toNext,
  );
  const rows = ms.slice(from).map((m, k) => ({ m, at: at[k], last: from + k === ms.length - 1 }));
  return (
    <ol className="nav-steps">
      {rows.map(({ m, at, last }, k) => (
        <li key={k}>
          <TurnIcon turn={turnOf(m.type)} size={22} />
          <span>
            {last ? destination : short(m)}
            {!last && road(m) && <small>{road(m)}</small>}
          </span>
          <small>{formatDistance(at, lang, units)}</small>
        </li>
      ))}
    </ol>
  );
}

/** Valhalla's maneuver type for entering a roundabout. */
const ROUNDABOUT = 26;

/** A turn this close after the next one is shown with it. */
const THEN_M = 150;

/** Above this (m/s, about 300 km/h) the speed is a GPS jump, not driving. */
const MAX_MS = 83;

/** Turn-by-turn: the next maneuver on top, time and distance left at the bottom. */
export function NavView(props: Props) {
  const { route, mode, nav, lang, muted, reroute, destination, open, ...on } = props;
  const now = useNow(15_000);
  const started = nav.snap !== null;
  const m = route.maneuvers[started ? nav.next : 0];
  // Before the first fix: the way the route sets off, and how far until its first turn.
  const toNext = started ? nav.toNext : route.maneuvers[0]?.distance;
  const eta = started ? nav.eta : route.duration;
  const remaining = started ? nav.remaining : route.distance;
  const speed = speedIn(nav.speed, units);
  const limits = useSpeedLimits(mode === 'car' ? route : undefined);
  // The limit where the car is on the route; off it, the road is another one.
  const limit = nav.snap && !nav.offRoute ? limitAt(limits, nav.snap.along) : null;
  const shownLimit = limit != null && Number.isFinite(limit) ? limitIn(limit, units) : null;
  const over = overLimit(nav.speed, limit);

  // Only while off the route: back on it, guidance carries on whatever the router said.
  const rerouting = nav.offRoute;
  const guiding = !nav.arrived && !rerouting;
  // Started away from the route: first there, how far its start is, nothing of what comes after.
  const heading = guiding && headingToRoute(nav);
  const lanes = !heading && guiding && lanesNeeded(m?.lanes) ? m.lanes : undefined;
  const size = lanes && started ? laneSize(nav.toNext, nav.speed, mode) : 'none';

  // The step after shows under the next one, so it is no surprise; close behind it, without
  // the distance between them.
  const after = route.maneuvers[started ? nav.next + 1 : 1];
  const then = guiding && !heading && m && after ? after : undefined;
  // How far from here, as in the steps list: the next turn's distance and on to this one.
  const thenFar =
    then && m.distance > THEN_M ? formatDistance((toNext ?? 0) + m.distance, lang, units) : null;
  const thenLast = then === route.maneuvers.at(-1);

  let title = m?.instruction ?? '';
  // On screen the street, where the arrow says the rest; the sentence is for screen readers.
  let shown = m ? short(m) : '';
  let turn = m ? turnOf(m.type) : 'straight';
  // The router's text for the destination is past tense; on the way there it reads ahead.
  if (started && !nav.arrived && m && nav.next === route.maneuvers.length - 1) {
    title = shown = m.alert ?? t.destinationAhead;
  }
  if (heading) {
    title = shown = t.headToRoute;
    turn = 'depart';
  }
  if (nav.arrived) {
    title = shown = t.arrived;
    turn = 'arrive';
  } else if (rerouting) {
    // Not the old route's arrow: while asking it says nothing about where to turn.
    title = shown = reroute === 'failed' ? t.rerouteFailed : t.rerouting;
    turn = reroute === 'failed' ? 'uturn' : 'depart';
  }
  const big = heading ? nav.toRoute : toNext;
  const arrival = fill(t.arriveAt, { time: formatClock(new Date(now + eta * 1000), lang) });
  useNavNotice(
    guiding && started && m ? `${formatDistance(big ?? 0, lang, units)} · ${title}` : title,
    `${formatDuration(eta)} · ${arrival}`,
  );
  // What the user should know besides the instruction: no position yet, or a poor one.
  const note = !started
    ? t.locating
    : nav.weak && !nav.arrived
      ? t.weakGps
      : guiding && !heading && m
        ? road(m)
        : null;

  return (
    <>
      <div className="ride-top">
        <section
          className="nav-banner"
          data-state={nav.arrived ? 'arrived' : rerouting ? 'rerouting' : 'go'}
        >
          {/* The whole banner opens the steps ahead; the button inside says so to a screen reader. */}
          {guiding && (
            <button
              type="button"
              className="ride-toggle"
              aria-expanded={open}
              aria-label={t.showSteps}
              onClick={() => on.onOpen(!open)}
            />
          )}
          <TurnIcon turn={turn} size={40} />
          <div>
            {guiding && big != null && <strong>{formatDistance(big, lang, units)}</strong>}
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
                <span className="nav-then-text">{thenLast ? destination : short(then)}</span>
                {thenFar && <small className="nav-then-far">{thenFar}</small>}
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
        {open && guiding && (
          <TripDetails onClose={() => on.onOpen(false)}>
            <Steps
              route={route}
              from={started ? nav.next + 1 : 1}
              toNext={toNext ?? 0}
              lang={lang}
              destination={destination}
            />
          </TripDetails>
        )}
      </div>

      {started && !nav.arrived && mode === 'car' && nav.speed <= MAX_MS && (
        <div
          className="speed surface"
          role="img"
          data-over={over || undefined}
          aria-label={[
            `${speed} ${speedLabel(units)}`,
            shownLimit != null ? fill(t.speedLimit, { n: shownLimit }) : '',
          ]
            .filter(Boolean)
            .join(', ')}
        >
          <strong>{speed}</strong>
          <small>{speedLabel(units)}</small>
          {shownLimit != null && <span className="limit">{shownLimit}</span>}
        </div>
      )}

      <NavBar muted={muted} onMute={on.onMute} onEnd={on.onEnd}>
        {/* Time left leads; a bare clock time would read as the time now. */}
        {nav.arrived ? (
          <strong>{destination}</strong>
        ) : (
          <>
            <strong>{formatDuration(eta)}</strong>
            <span>
              {arrival} · {formatDistance(remaining, lang, units)}
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
      <NavBar muted={on.muted} onMute={on.onMute} onEnd={on.onEnd}>
        <span>{destination}</span>
      </NavBar>
    </>
  );
}
