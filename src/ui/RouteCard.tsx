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
import { fill, t, units } from '../i18n';
import { arrowRadios, focusSearch, useFocusOnMount } from './a11y';
import { CloseIcon, LocateIcon, ModeIcon, SwapIcon, TurnIcon } from './icons';
import { isNative } from './native';
import { Sheet } from './Sheet';
import type { LocationStatus } from './useLocation';
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
  /** Waiting for a location that will not come (denied, none) offers another start. */
  location: LocationStatus;
  lang: string;
  onMode: (mode: TravelMode) => void;
  onActive: (index: number) => void;
  onChangeStart: () => void;
  onChangeEnd: () => void;
  onUseMyLocation: () => void;
  /** Start and destination change places; absent while there is no position to swap. */
  onSwap?: () => void;
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
  busy: t.routeBusy,
  failed: t.routeFailed,
};

export function RouteCard(props: Props) {
  const { to, from, mode, routes, active, status, location, lang } = props;
  const stuck = status === 'locating' && (location === 'denied' || location === 'unavailable');
  const message = stuck
    ? location === 'denied'
      ? t.locationDenied
      : t.noLocation
    : status === 'none'
      ? t[`noRoute_${mode}`]
      : MESSAGE[status];
  const route = status === 'ready' ? routes[active] : undefined;
  // Start only for a route, or in its place while one is coming: never a dead button.
  const startable = route || status === 'loading' || (status === 'locating' && !stuck);
  const now = useNow();
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const clock = (ms: number) => formatClock(new Date(ms), lang);
  const transit = route?.transit;
  const arrival = route && clock(transit ? transit.end : now + route.duration * 1000);
  /** "08:12–08:47" for a connection, the distance for a road route. */
  const span = (r: Route) =>
    r.transit
      ? `${clock(r.transit.start)}–${clock(r.transit.end)}`
      : formatDistance(r.distance, lang, units);

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
          <span>{message}</span>
        )
      }
    >
      <h2 className="sr-only" ref={heading} tabIndex={-1}>
        {fill(t.routeTo, { name: to.name })}
      </h2>
      <header>
        <div className="modes" role="radiogroup" aria-label={t.travelMode} onKeyDown={arrowRadios}>
          {TRAVEL_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === mode}
              tabIndex={m === mode ? 0 : -1}
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
          onClick={(e) => {
            props.onClose();
            if (e.detail === 0) focusSearch();
          }}
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
        <button
          type="button"
          className="icon-btn swap"
          aria-label={t.swapEnds}
          title={t.swapEnds}
          disabled={!props.onSwap}
          onClick={props.onSwap}
        >
          <SwapIcon />
        </button>
      </dl>

      {mode === 'transit' && <DepartTime at={props.at} now={now} onDepart={props.onDepart} />}

      {route ? (
        <div className="summary">
          <strong>{formatDuration(route.duration)}</strong>
          <span>
            {transit
              ? `${span(route)} · ${changesText(transit)}`
              : `${formatDistance(route.distance, lang, units)} · ${fill(t.arriveAt, { time: arrival ?? '' })}`}
          </span>
        </div>
      ) : (
        <p className="route-msg" role="status" data-status={stuck ? 'stuck' : status}>
          {message}
          {/* Waiting for a position that may never come: a start can be chosen instead. */}
          {status === 'locating' && (
            <button type="button" onClick={props.onChangeStart}>
              {t.chooseStart}
            </button>
          )}
          {status === 'none' && (
            // No way by this mode (a car-free zone, a ferry-only island): offer the others.
            <span className="route-try" role="group" aria-label={t.tryOther}>
              {TRAVEL_MODES.filter((m) => m !== mode).map((m) => (
                <button key={m} type="button" onClick={() => props.onMode(m)}>
                  <ModeIcon mode={m} />
                  {t[`by_${m}`]}
                </button>
              ))}
            </span>
          )}
          {(status === 'busy' || status === 'failed') && (
            <button type="button" onClick={props.onRetry}>
              {t.retry}
            </button>
          )}
        </p>
      )}

      {route && routes.length > 1 && (
        <div className="alts" role="radiogroup" aria-label={t.alternatives} onKeyDown={arrowRadios}>
          {routes.map((r, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={i === active}
              tabIndex={i === active ? 0 : -1}
              onClick={() => props.onActive(i)}
            >
              {r.transit ? clock(r.transit.start) : formatDuration(r.duration)}
              {r.transit && <LineChips transit={r.transit} />}
              <small>
                {r.transit ? formatDuration(r.duration) : formatDistance(r.distance, lang, units)}
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
                {/* The router's "You have arrived" reads as done; the list reads ahead. */}
                <span>
                  {turnOf(m.type) === 'arrive'
                    ? fill(t.arriveAtName, { name: to.name })
                    : m.instruction}
                </span>
                {m.distance > 0 && <small>{formatDistance(m.distance, lang, units)}</small>}
              </li>
            ))}
          </ol>
        </details>
      )}

      {props.onStart && startable && (
        <div className="actions">
          <button
            type="button"
            className="action primary"
            disabled={!route}
            onClick={props.onStart}
          >
            <TurnIcon turn="depart" size={18} />
            {t.start}
          </button>
        </div>
      )}
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
