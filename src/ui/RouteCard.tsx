import {
  MODES,
  formatClock,
  formatDistance,
  formatDuration,
  turnOf,
  type Mode,
  type Route,
  type RouteError,
} from '../core/route';
import { directionsUrl, geoUri } from '../core/geo';
import type { Place } from '../core/search';
import { t } from '../i18n';
import { CloseIcon, LocateIcon, ModeIcon, TurnIcon } from './icons';
import { isNative } from './native';
import { Sheet } from './Sheet';
import { useNow } from './useNow';

export type RouteStatus = 'locating' | 'loading' | 'ready' | Exclude<RouteError, 'none'> | 'none';

interface Props {
  to: Place;
  from: Place | null;
  mode: Mode;
  routes: Route[];
  active: number;
  status: RouteStatus;
  lang: string;
  onMode: (mode: Mode) => void;
  onActive: (index: number) => void;
  onChangeStart: () => void;
  onChangeEnd: () => void;
  onUseMyLocation: () => void;
  onRetry: () => void;
  onClose: () => void;
  onStart?: () => void;
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
  const arrival = route && formatClock(new Date(now + route.duration * 1000), lang);

  return (
    <Sheet
      className="card route surface"
      busy={status === 'loading'}
      peek={
        route ? (
          <>
            <strong className="peek-time">{formatDuration(route.duration)}</strong>
            <span>
              {formatDistance(route.distance, lang)} · {to.name}
            </span>
          </>
        ) : (
          <span>{MESSAGE[status]}</span>
        )
      }
    >
      <header>
        <div className="modes" role="radiogroup" aria-label={t.travelMode}>
          {MODES.map((m) => (
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

      {route ? (
        <div className="summary">
          <strong>{formatDuration(route.duration)}</strong>
          <span>
            {formatDistance(route.distance, lang)} · {t.arriveAt} {arrival}
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
              {formatDuration(r.duration)}
              <small>{formatDistance(r.distance, lang)}</small>
            </button>
          ))}
        </div>
      )}

      {route && (
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
