import { laneSize, lanesNeeded, laneViews } from '../core/lanes';
import type { NavState } from '../core/nav';
import {
  formatClock,
  formatDistance,
  formatDuration,
  turnOf,
  type Mode,
  type Route,
} from '../core/route';
import { t } from '../i18n';
import { LaneIcon, LocateIcon, TurnIcon } from './icons';
import { NavBar } from './NavBar';
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

/** Above this the speed is a GPS jump, not driving. */
const MAX_KMH = 300;

/** Turn-by-turn: the next maneuver on top, time and distance left at the bottom. */
export function NavView({ route, mode, nav, lang, muted, following, reroute, ...on }: Props) {
  const now = useNow(15_000);
  const started = nav.snap !== null;
  const m = route.maneuvers[started ? nav.next : 0];
  const eta = started ? nav.eta : route.duration;
  const remaining = started ? nav.remaining : route.distance;
  const kmh = Math.round(nav.speed * 3.6);

  // Only while off the route: back on it, guidance carries on whatever the router said.
  const rerouting = nav.offRoute;
  const guiding = started && !nav.arrived && !rerouting;
  const lanes = guiding && lanesNeeded(m?.lanes) ? m.lanes : undefined;
  const size = lanes ? laneSize(nav.toNext, nav.speed, mode) : 'none';

  let title = m?.instruction ?? '';
  let turn = m ? turnOf(m.type) : 'straight';
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
        aria-live="polite"
        data-state={nav.arrived ? 'arrived' : rerouting ? 'rerouting' : 'go'}
      >
        <TurnIcon turn={turn} size={40} />
        <div>
          {guiding && <strong>{formatDistance(nav.toNext, lang)}</strong>}
          <p>{title}</p>
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

      {started && !nav.arrived && mode === 'car' && kmh <= MAX_KMH && (
        <div className="speed surface" role="img" aria-label={`${kmh} ${t.speedUnit}`}>
          <strong>{kmh}</strong>
          <small>{t.speedUnit}</small>
        </div>
      )}

      <NavBar muted={muted} arrived={nav.arrived} onMute={on.onMute} onEnd={on.onEnd}>
        <strong>{formatClock(new Date(now + eta * 1000), lang)}</strong>
        <span>
          {formatDuration(eta)} · {formatDistance(remaining, lang)}
        </span>
      </NavBar>
    </>
  );
}
