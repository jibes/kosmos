import {
  TRAVEL_MODES,
  formatClock,
  formatDistance,
  formatDuration,
  turnOf,
  type Route,
  type RouteError,
  type TravelMode,
} from '../core/route';
import { directionsUrl, geoUri } from '../core/geo';
import type { Place } from '../core/search';
import { t } from '../i18n';
import { CloseIcon, LocateIcon, ModeIcon, TurnIcon } from './icons';
import { isNative } from './native';
import { Sheet } from './Sheet';
import { changesText, DepartTime, LineChips, TransitCredit, TransitLegs } from './TransitParts';
import { useNow } from './useNow';

export type RouteStatus = 'locating' | 'loading' | 'ready' | Exclude<RouteError, 'none'> | 'none';

interface Props {
  to: Place;
  from: Place | null;
  mode: TravelMode;
  routes: Route[];
  active: number;
  status: RouteStatus;
  lang: string;
  onMode: (mode: TravelMode) => void;
  onActive: (index: number) => void;
  onChangeStart: () => void;
  onChangeEnd: () => void;
  onUseMyLocation: () => void;
  onRetry: () => void;
  onClose: () => void;
  /** Absent hides Start. */
  onStart?: () => void;
  /** Public transport departure; `null` is now. */
  at: number | null;
  onDepart: (at: number | null) => void;
}

const MESSAGE: Partial<Record<RouteStatus, string>> = {
  locating: t.locating,
  loading: t.routing,
  none: t.noRoute,
  busy: t.routeBusy,
  failed: t.routeFailed,
};

export function RouteCard(props: Props) {
  const { to, from, mode, routes, active, status, lang } = props;
  const route = status === 'ready' ? routes[active] : undefined;
  const now = useNow();
  const clock = (ms: number) => formatClock(new Date(ms), lang);
  const transit = route?.transit;
  const arrival = route && clock(transit ? transit.end : now + route.duration * 1000);
  /** "08:12–08:47" for a connection, the distance for a road route. */
  const span = (r: Route) =>
    r.transit
      ? `${clock(r.transit.start)}–${clock(r.transit.end)}`
      : formatDistance(r.distance, lang);

  return (
    <Sheet
      className="card route surface"
      busy={status === 'loading'}
      peek={
        route ? (
          <>
            <strong className="peek-time">{formatDuration(route.duration)}</strong>
            <span>
              {span(route)} · {to.name}
            </span>
          </>
        ) : (
          <span>{MESSAGE[status]}</span>
        )
      }
    >
      <header>
        <div className="modes" role="radiogroup" aria-label={t.travelMode}>
          {TRAVEL_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === mode}
              aria-label={t[m]}
              title={t[m]}
              onClick={() => props.onMode(m)}
            >
              <ModeIcon mode={m} />
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-btn round"
          aria-label={t.close}
          onClick={props.onClose}
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <dl className="ends">
        <dt>{t.from}</dt>
        <dd>
          <button type="button" className="end-btn" onClick={props.onChangeStart}>
            {from ? from.name : t.myLocation}
          </button>
          {from && (
            <button
              type="button"
              className="icon-btn"
              aria-label={t.useMyLocation}
              title={t.useMyLocation}
              onClick={props.onUseMyLocation}
            >
              <LocateIcon />
            </button>
          )}
        </dd>
        <dt>{t.to}</dt>
        <dd>
          <button type="button" className="end-btn" onClick={props.onChangeEnd}>
            {to.name}
          </button>
        </dd>
      </dl>

      {mode === 'transit' && <DepartTime at={props.at} now={now} onDepart={props.onDepart} />}

      {route ? (
        <div className="summary">
          <strong>{formatDuration(route.duration)}</strong>
          <span>
            {transit
              ? `${span(route)} · ${changesText(transit)}`
              : `${formatDistance(route.distance, lang)} · ${t.arriveAt} ${arrival}`}
          </span>
        </div>
      ) : (
        <p className="route-msg" data-status={status}>
          {MESSAGE[status]}
          {(status === 'busy' || status === 'failed') && (
            <button type="button" onClick={props.onRetry}>
              {t.retry}
            </button>
          )}
        </p>
      )}

      {route && routes.length > 1 && (
        <div className="alts" role="radiogroup" aria-label={t.alternatives}>
          {routes.map((r, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={i === active}
              onClick={() => props.onActive(i)}
            >
              {r.transit ? clock(r.transit.start) : formatDuration(r.duration)}
              {r.transit && <LineChips transit={r.transit} />}
              <small>
                {r.transit ? formatDuration(r.duration) : formatDistance(r.distance, lang)}
              </small>
            </button>
          ))}
        </div>
      )}

      {transit && <TransitLegs transit={transit} lang={lang} />}

      {route && !transit && (
        <details className="steps">
          <summary>
            {t.steps} <small>{route.maneuvers.length}</small>
          </summary>
          <ol>
            {route.maneuvers.map((m, i) => (
              <li key={i}>
                <TurnIcon turn={turnOf(m.type)} size={18} />
                <span>{m.instruction}</span>
                {m.distance > 0 && <small>{formatDistance(m.distance, lang)}</small>}
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="actions">
        {props.onStart && (
          <button
            type="button"
            className="action primary"
            disabled={!route}
            onClick={props.onStart}
          >
            <TurnIcon turn="depart" size={18} />
            {t.start}
          </button>
        )}
      </div>
      {mode === 'transit' && <TransitCredit />}
      <a
        className="quiet-link"
        href={isNative ? geoUri(to, to.name) : directionsUrl(to)}
        target={isNative ? undefined : '_blank'}
        rel="noreferrer"
      >
        {t.openIn}
      </a>
    </Sheet>
  );
}
