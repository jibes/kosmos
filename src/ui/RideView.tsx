import type { RidePrompt, RideState } from '../core/ride';
import { formatClock, formatDistance, formatDuration } from '../core/route';
import type { Transit, TransitLeg } from '../core/transit';
import { fill, t } from '../i18n';
import { LocateIcon, ModeIcon, TurnIcon } from './icons';
import { SoundIcon } from './NavView';
import { LineChip } from './TransitParts';

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
      big = formatDistance(st.turn.in, lang);
      title = st.turn.street ?? walkTo;
      goal = `${walkTo} · ${formatDistance(st.toGo, lang)}`;
    } else {
      big = formatDistance(st.toGo, lang);
      title = walkTo;
    }
    if (ride && st.missed) sub = fill(t.hasLeft, { line: ride.line ?? t.transit });
    else if (ride)
      sub = `${fill(t.leaves, { line: ride.line ?? t.transit, time: clock(ride.start) })}${platform}`;
  } else if (st.phase === 'wait' && leg) {
    icon = <LineChip leg={leg} big />;
    big = when;
    title = leg.headsign ? `→ ${leg.headsign}` : (leg.line ?? t.transit);
    sub = `${fill(t.leaves, { line: leg.line ?? t.transit, time: clock(leg.start) })}${platform}`;
  } else if (st.phase === 'ride' && leg) {
    icon = <LineChip leg={leg} big />;
    big = st.stopsLeft === 1 ? t.nextStop : fill(t.stops, { n: st.stopsLeft });
    title = fill(t.getOffAt, { stop: endName(transit, st.leg, destination) });
    sub = `${t.arriveAt} ${clock(leg.end)}`;
  } else if (st.phase === 'arrived') {
    icon = <ModeIcon mode="transit" size={40} />;
  }

  return (
    <>
      <section
        className="nav-banner ride"
        aria-live="polite"
        data-state={st.phase === 'arrived' ? 'arrived' : st.missed ? 'rerouting' : 'go'}
        data-phase={st.phase}
      >
        {icon}
        <div>
          {big && <strong>{big}</strong>}
          <p>{title}</p>
          {goal && <small>{goal}</small>}
          {sub && <small>{sub}</small>}
        </div>
        {st.missed && (
          <button type="button" className="ride-new" onClick={on.onNewConnection}>
            {t.newConnection}
          </button>
        )}
      </section>

      {!following && (
        <button type="button" className="recenter surface" onClick={on.onRecenter}>
          <LocateIcon filled />
          {t.recenter}
        </button>
      )}

      <section className="nav-bar surface">
        <div className="nav-eta">
          <strong>{clock(transit.end)}</strong>
          <span>
            {formatDuration(Math.max(0, (transit.end - st.time) / 1000))} · {destination}
          </span>
        </div>
        <button
          type="button"
          className="icon-btn round big"
          aria-label={muted ? t.unmute : t.mute}
          aria-pressed={muted}
          onClick={on.onMute}
        >
          <SoundIcon off={muted} />
        </button>
        <button type="button" className="nav-end" onClick={on.onEnd}>
          {t.end}
        </button>
      </section>
    </>
  );
}
