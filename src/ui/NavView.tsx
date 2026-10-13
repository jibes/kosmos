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
import { useNow } from './useNow';

interface Props {
  route: Route;
  mode: Mode;
  nav: NavState;
  lang: string;
  muted: boolean;
  following: boolean;
  rerouting: boolean;
  onMute: () => void;
  onRecenter: () => void;
  onEnd: () => void;
}

export const SoundIcon = ({ off }: { off: boolean }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" />
    {off ? (
      <path d="m16 9.5 5 5m0-5-5 5" />
    ) : (
      <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
    )}
  </svg>
);

/** Turn-by-turn: the next maneuver on top, time and distance left at the bottom. */
export function NavView({ route, mode, nav, lang, muted, following, rerouting, ...on }: Props) {
  const now = useNow(15_000);
  const started = nav.snap !== null;
  const m = route.maneuvers[started ? nav.next : 0];
  const eta = started ? nav.eta : route.duration;
  const remaining = started ? nav.remaining : route.distance;

  const guiding = started && !nav.arrived && !rerouting && !nav.offRoute;
  const lanes = guiding && lanesNeeded(m?.lanes) ? m.lanes : undefined;
  const size = lanes ? laneSize(nav.toNext, nav.speed, mode) : 'none';

  let title = m?.instruction ?? '';
  let turn = m ? turnOf(m.type) : 'straight';
  if (nav.arrived) {
    title = t.arrived;
    turn = 'arrive';
  } else if (rerouting || nav.offRoute) {
    title = t.rerouting;
  }

  return (
    <>
      <section
        className="nav-banner"
        aria-live="polite"
        data-state={nav.arrived ? 'arrived' : rerouting || nav.offRoute ? 'rerouting' : 'go'}
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

      {started && !nav.arrived && (
        <div className="speed surface" aria-label={`${Math.round(nav.speed * 3.6)} ${t.speedUnit}`}>
          <strong>{Math.round(nav.speed * 3.6)}</strong>
          <small>{t.speedUnit}</small>
        </div>
      )}

      <section className="nav-bar surface">
        <div className="nav-eta">
          <strong>{formatClock(new Date(now + eta * 1000), lang)}</strong>
          <span>
            {formatDuration(eta)} · {formatDistance(remaining, lang)}
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
