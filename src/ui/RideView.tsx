import { useState } from 'react';
import type { RidePrompt, RideState } from '../core/ride';
import { formatClock, formatDistance, formatDuration } from '../core/route';
import type { Transit, TransitLeg } from '../core/transit';
import { fill, t, units } from '../i18n';
import { LocateIcon, ModeIcon, TurnIcon } from './icons';
import { NavBar } from './NavBar';
import { LineChip, TransitLegs } from './TransitParts';

interface Props {
  transit: Transit;
  st: RideState;
  /** The destination's own name; the planner calls it "END". */
  destination: string;
  lang: string;
  muted: boolean;
  following: boolean;
  onMute: () => void;
  onRecenter: () => void;
  onNewConnection: () => void;
  onEnd: () => void;
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
        line: leg.line ?? t.transit,
        dir: leg.headsign ?? '',
        time: clock(leg.start),
      });
    case 'next':
      return fill(t.sayNext, { stop: endName(transit, p.leg, destination) });
    default:
      return t.arrived;
  }
}

/** On the way by public transport: one line saying what to do now, the arrival at the bottom. */
export function RideView({ transit, st, destination, lang, muted, following, ...on }: Props) {
  /** The whole connection, every stop and turn, under the banner. */
  const [open, setOpen] = useState(false);
  const clock = (ms: number) => formatClock(new Date(ms), lang);
  const leg = transit.legs[st.leg] as TransitLeg | undefined;
  const next = transit.legs[st.leg + 1];
  const ride = leg?.ride ? leg : next?.ride ? next : undefined;
  const platform = ride?.from.track ? ` · ${t.platform} ${ride.from.track}` : '';
  const minutes = ride ? Math.round((ride.start - st.time) / 60_000) : 0;
  const when = minutes > 0 ? fill(t.inMin, { n: minutes }) : t.departsNow;

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
    if (ride && st.cancelled) sub = fill(t.lineCancelled, { line: ride.line ?? t.transit });
    else if (ride && st.missed) sub = fill(t.hasLeft, { line: ride.line ?? t.transit });
    else if (ride)
      sub = `${fill(t.leaves, { line: ride.line ?? t.transit, time: clock(ride.start) })}${platform}`;
  } else if (st.phase === 'wait' && leg) {
    icon = <LineChip leg={leg} big />;
    big = when;
    title = leg.headsign ? `→ ${leg.headsign}` : (leg.line ?? t.transit);
    sub = st.cancelled
      ? fill(t.lineCancelled, { line: leg.line ?? t.transit })
      : `${fill(t.leaves, { line: leg.line ?? t.transit, time: clock(leg.start) })}${platform}`;
    if (st.cancelled) big = t.cancelled;
  } else if (st.phase === 'ride' && leg) {
    icon = <LineChip leg={leg} big />;
    big = st.stopsLeft === 1 ? t.nextStop : fill(t.stops, { n: st.stopsLeft });
    title = fill(t.getOffAt, { stop: endName(transit, st.leg, destination) });
    sub = fill(t.arriveAt, { time: clock(leg.end) });
  } else if (st.phase === 'arrived') {
    icon = <ModeIcon mode="transit" size={40} />;
  }

  // Of the current ride's stops (those passed through, then the one to get off at), how many
  // are behind the rider.
  const passed = st.phase === 'ride' && leg ? leg.via.length + 1 - st.stopsLeft : 0;

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
            onClick={() => setOpen((o) => !o)}
          />
          {icon}
          <div>
            {big && <strong>{big}</strong>}
            <p aria-live="polite">{title}</p>
            {goal && <small>{goal}</small>}
            {sub && <small>{sub}</small>}
          </div>
          {(st.missed || st.cancelled) && (
            <button
              type="button"
              className="ride-new"
              onClick={(e) => {
                e.stopPropagation();
                on.onNewConnection();
              }}
            >
              {t.newConnection}
            </button>
          )}
        </section>
        {open && (
          <section className="ride-details surface">
            <TransitLegs
              transit={transit}
              lang={lang}
              current={Math.min(st.leg, transit.legs.length - 1)}
              passed={passed}
              destination={destination}
            />
          </section>
        )}
      </div>

      {!following && (
        <button type="button" className="recenter surface" onClick={on.onRecenter}>
          <LocateIcon filled />
          {t.recenter}
        </button>
      )}

      <NavBar muted={muted} arrived={st.phase === 'arrived'} onMute={on.onMute} onEnd={on.onEnd}>
        <strong>{clock(transit.end)}</strong>
        <span>
          {formatDuration(Math.max(0, (transit.end - st.time) / 1000))} · {destination}
        </span>
      </NavBar>
    </>
  );
}
