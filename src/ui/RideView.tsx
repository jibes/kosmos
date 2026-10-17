import { FRESH_MS, type RidePrompt, type RideState } from '../core/ride';
import type { Place } from '../core/search';
import { formatClock, formatDistance, formatDuration } from '../core/route';
import { servedBefore, type Transit, type TransitLeg } from '../core/transit';
import { capital, fill, t, units } from '../i18n';
import { ModeIcon, TurnIcon } from './icons';
import { NavBar } from './NavBar';
import { TripDetails } from './TripDetails';
import { LineChip, TransitLegs, lineName, platformWord, sayPlatformOf } from './TransitParts';

interface Props {
  transit: Transit;
  st: RideState;
  /** The destination's own name; the planner calls it "END". */
  destination: string;
  lang: string;
  muted: boolean;
  onMute: () => void;
  onNewConnection: () => void;
  /** Asking for a new connection, or none came and the old one stands. */
  connecting: 'idle' | 'asking' | 'failed';
  onEnd: () => void;
  /** The whole connection, every stop and turn, open under the banner (Back closes it). */
  open: boolean;
  onOpen: (open: boolean) => void;
}

/**
 * Where a new connection starts: from the rider's position while it is fresh (`null`), else from
 * the stop they are at or making for; underground the last fix may lie kilometres back.
 */
export function connectionStart(transit: Transit, st: RideState, now: number): Place | null {
  if (st.fix && now - st.fix.time < FRESH_MS) return null;
  const leg = transit.legs[Math.min(st.leg, transit.legs.length - 1)];
  const stop = st.phase === 'wait' ? leg.from : leg.to;
  return { name: stop.name, detail: '', lng: stop.lng, lat: stop.lat };
}

/** Where a leg ends, in words: the last one ends at the destination. */
const endName = (transit: Transit, i: number, destination: string) =>
  i === transit.legs.length - 1 ? destination : transit.legs[i].to.name;

/** The spoken words for a ride prompt. */
export function rideWords(transit: Transit, p: RidePrompt, destination: string, lang: string) {
  const leg = transit.legs[p.leg];
  const clock = (ms: number) => formatClock(new Date(ms), lang);
  switch (p.kind) {
    case 'walk':
      return fill(t.sayWalk, { stop: endName(transit, p.leg, destination) });
    case 'board':
      return fill(leg.headsign ? t.sayBoard : t.sayBoardPlain, {
        line: lineName(leg),
        dir: leg.headsign ?? '',
        time: clock(leg.start),
      });
    case 'next':
      return fill(t.sayNext, { stop: endName(transit, p.leg, destination) });
    case 'missed':
      return fill(t.sayMissed, { line: lineName(leg) });
    case 'cancelled':
      return fill(t.sayCancelled, { line: lineName(leg) });
    case 'platform':
      return fill(sayPlatformOf(leg), { line: lineName(leg), track: leg.from.track ?? '' });
    case 'delay':
      return fill(t.sayDelay, { line: lineName(leg), n: leg.delay });
    default:
      return t.arrived;
  }
}

/** On the way by public transport: one line saying what to do now, the arrival at the bottom. */
export function RideView(props: Props) {
  const { transit, st, destination, lang, muted, connecting, open, ...on } = props;
  const clock = (ms: number) => formatClock(new Date(ms), lang);
  const leg = transit.legs[st.leg] as TransitLeg | undefined;
  const next = transit.legs[st.leg + 1];
  const ride = leg?.ride ? leg : next?.ride ? next : undefined;
  const platform = ride?.from.track ? ` · ${platformWord(ride)} ${ride.from.track}` : '';
  const minutes = ride ? Math.round((ride.start - st.time) / 60_000) : 0;
  // Beyond an hour (tomorrow morning) the time itself says more than "in 380 min".
  const when =
    minutes > 60 && ride
      ? clock(ride.start)
      : minutes > 0
        ? fill(t.inMin, { n: minutes })
        : t.departsNow;
  // What changed, for screen readers too (the voice may be off): gone, cancelled, new platform.
  const moved = ride?.from.scheduledTrack && ride.from.track !== ride.from.scheduledTrack;
  const change = !ride
    ? ''
    : st.missed
      ? fill(t.hasLeft, { line: lineName(ride) })
      : st.cancelled
        ? fill(t.lineCancelled, { line: lineName(ride) })
        : moved
          ? `${lineName(ride)} · ${platformWord(ride)} ${ride.from.track}`
          : '';
  const left = (transit.end - st.time) / 1000;

  let icon = <ModeIcon mode="foot" size={40} />;
  let big = '';
  let title = t.arrived;
  let sub = '';
  /** Walking with a turn ahead: where to, overall. */
  let goal = '';
  if (st.phase === 'walk' && leg) {
    const walkTo = fill(t.walkTo, { stop: endName(transit, st.leg, destination) });
    if (st.turn) {
      // The next turn leads, as in road navigation; the stop and its distance follow.
      icon = <TurnIcon turn={st.turn.turn} size={40} />;
      big = formatDistance(st.turn.in, lang, units);
      title = st.turn.street ?? walkTo;
      goal = `${walkTo} · ${formatDistance(st.toGo, lang, units)}`;
    } else {
      big = formatDistance(st.toGo, lang, units);
      title = walkTo;
    }
    if (ride && st.cancelled) sub = fill(t.lineCancelled, { line: lineName(ride) });
    else if (ride && st.missed) sub = fill(t.hasLeft, { line: lineName(ride) });
    else if (ride)
      sub = `${fill(t.leaves, { line: lineName(ride), time: clock(ride.start) })}${platform}`;
  } else if (st.phase === 'wait' && leg) {
    icon = <LineChip leg={leg} big />;
    big = when;
    title = leg.headsign ? `→ ${leg.headsign}` : lineName(leg);
    sub = st.cancelled
      ? fill(t.lineCancelled, { line: lineName(leg) })
      : `${fill(t.leaves, { line: lineName(leg), time: clock(leg.start) })}${platform}`;
    if (st.cancelled) big = t.cancelled;
  } else if (st.phase === 'ride' && leg) {
    icon = <LineChip leg={leg} big />;
    big = st.stopsLeft === 1 ? t.nextStop : fill(t.stops, { n: st.stopsLeft });
    title = fill(t.getOffAt, { stop: endName(transit, st.leg, destination) });
    sub = fill(t.arriveAt, { time: clock(leg.end) });
  } else if (st.phase === 'arrived') {
    icon = <ModeIcon mode="transit" size={40} />;
  }

  // Of the current ride's stops served (those passed through, then the one to get off at), how
  // many are behind the rider.
  // Stops the vehicle skips today are not counted, as they are not stopped at.
  const passed =
    st.phase === 'ride' && leg ? servedBefore(leg, leg.via.length) + 1 - st.stopsLeft : 0;

  return (
    <>
      <div className="ride-top">
        <section
          className="nav-banner ride"
          data-state={
            st.phase === 'arrived' ? 'arrived' : st.missed || st.cancelled ? 'rerouting' : 'go'
          }
          data-phase={st.phase}
        >
          {/* The whole banner opens the trip; the button inside says so to a screen reader. */}
          <button
            type="button"
            className="ride-toggle"
            aria-expanded={open}
            aria-label={t.showTrip}
            onClick={() => on.onOpen(!open)}
          />
          {icon}
          <div>
            {big && <strong>{capital(big)}</strong>}
            <p aria-live="polite">{title}</p>
            {goal && <small>{capital(goal)}</small>}
            {sub && <small>{capital(sub)}</small>}
            {connecting === 'failed' && <small>{t.noRoute}</small>}
            <span className="sr-only" aria-live="polite">
              {change && capital(change)}
            </span>
          </div>
          {(st.missed || st.cancelled) && (
            <button
              type="button"
              className="ride-new"
              disabled={connecting === 'asking'}
              onClick={(e) => {
                e.stopPropagation();
                on.onNewConnection();
              }}
            >
              {connecting === 'asking' ? t.routing : t.newConnection}
            </button>
          )}
        </section>
        {open && (
          <TripDetails onClose={() => on.onOpen(false)}>
            <TransitLegs
              transit={transit}
              lang={lang}
              current={Math.min(st.leg, transit.legs.length - 1)}
              passed={passed}
              riding={st.phase === 'ride'}
              destination={destination}
            />
          </TripDetails>
        )}
      </div>

      <NavBar muted={muted} arrived={st.phase === 'arrived'} onMute={on.onMute} onEnd={on.onEnd}>
        {/* Time left leads, as on the road; due or late, the arrival time itself. */}
        {st.phase === 'arrived' ? (
          <strong>{destination}</strong>
        ) : (
          <>
            <strong>{left > 60 ? formatDuration(left) : clock(transit.end)}</strong>
            <span>
              {left > 60 && `${fill(t.arriveAt, { time: clock(transit.end) })} · `}
              {destination}
            </span>
          </>
        )}
      </NavBar>
    </>
  );
}
