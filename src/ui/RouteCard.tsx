import { useState } from 'react';
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
import { arrowRadios, useFocusOnMount } from './a11y';
import { CloseIcon, CoinsIcon, ModeIcon, TurnIcon } from './icons';
import { isNative, openAppSettings, openElsewhere } from './native';
import { AlongRoute, type AlongSearch } from './AlongRoute';
import { Sheet } from './Sheet';
import { PointList, type PointListProps } from './PointList';
import type { LocationStatus } from './useLocation';
import {
  changesText,
  DepartTime,
  LineChips,
  Tickets,
  TransitCredit,
  TransitLegs,
} from './TransitParts';
import { useNow } from './useNow';

export type RouteStatus = 'locating' | 'loading' | 'ready' | Exclude<RouteError, 'none'> | 'none';

interface Props {
  to: Place;
  /** Start, stops, destination: dragged, changed by name or taken off. */
  points: PointListProps;
  /** Absent while no more can be added (public transport, or `MAX_STOPS` already). */
  onAdd?: () => void;
  mode: TravelMode;
  routes: Route[];
  active: number;
  status: RouteStatus;
  /** Waiting for a location that will not come (denied, none) offers another start. */
  location: LocationStatus;
  lang: string;
  onMode: (mode: TravelMode) => void;
  onActive: (index: number) => void;
  /** No position yet: another start, by name. */
  onChangeStart: () => void;
  onRetry: () => void;
  onClose: () => void;
  /** Absent hides Start. */
  onStart?: () => void;
  /** Public transport departure; `null` is now. */
  at: number | null;
  onDepart: (at: number | null) => void;
  /** Places along the chosen way (road routes). */
  along?: AlongSearch;
}

const MESSAGE: Partial<Record<RouteStatus, string>> = {
  locating: t.locating,
  loading: t.routing,
  busy: t.routeBusy,
  failed: t.routeFailed,
};

export function RouteCard(props: Props) {
  const { to, mode, routes, active, status, location, lang } = props;
  const stuck = status === 'locating' && (location === 'denied' || location === 'unavailable');
  const message = stuck
    ? location === 'denied'
      ? t.locationDenied
      : t.noLocation
    : status === 'none'
      ? t[`noRoute_${mode}`]
      : status === 'noRoad'
        ? t[`noRoad_${mode}`]
        : status === 'tooFar'
          ? t.routeTooFar
          : // Online and still failed: the server, not the connection.
            status === 'failed' && navigator.onLine
            ? t.routeDown
            : MESSAGE[status];
  // While a changed trip is asked for, the last ways found stay, dimmed, so nothing below the
  // points jumps (a road route for a road one: public transport is laid out otherwise).
  /** Places along the way, open under the links (closed again for another way of travel). */
  const [alongOpen, setAlongOpen] = useState(false);
  const [alongMode, setAlongMode] = useState(mode);
  if (alongMode !== mode) {
    setAlongMode(mode);
    setAlongOpen(false);
  }
  const [last, setLast] = useState({ routes, transit: mode === 'transit' });
  if (status === 'ready' && routes !== last.routes)
    setLast({ routes, transit: mode === 'transit' });
  const stale = status === 'loading' && last.transit === (mode === 'transit');
  const ways = status === 'ready' ? routes : stale ? last.routes : [];
  const route = ways[Math.min(active, ways.length - 1)];
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
          // The place card under it, if any, takes focus again on its own.
          onClick={props.onClose}
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <PointList {...props.points} />
      {/* Both about stops: one by name, or one found along the way. */}
      <div className="card-links">
        {props.onAdd && (
          <button type="button" className="quiet-link add-stop" onClick={props.onAdd}>
            <span aria-hidden="true">+ </span>
            {t.addStop}
          </button>
        )}
        {route && mode !== 'transit' && props.along && (
          <button
            type="button"
            className="quiet-link add-stop"
            aria-expanded={alongOpen}
            onClick={() => setAlongOpen(!alongOpen)}
          >
            {t.alongWay}
          </button>
        )}
      </div>
      {alongOpen && route && mode !== 'transit' && props.along && (
        <AlongRoute
          route={route}
          mode={mode}
          from={0}
          lang={lang}
          heading={false}
          {...props.along}
        />
      )}

      {mode === 'transit' && <DepartTime at={props.at} now={now} onDepart={props.onDepart} />}

      {route ? (
        <div className="summary">
          <strong>{formatDuration(route.duration)}</strong>
          <span>
            {transit ? (
              `${span(route)} · ${changesText(transit)}`
            ) : (
              <>
                {formatDistance(route.distance, lang, units)}
                {route.toll && (
                  <>
                    {' · '}
                    <CoinsIcon /> {t.tolls}
                  </>
                )}
                {` · ${fill(t.arriveAt, { time: arrival ?? '' })}`}
              </>
            )}
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
          {stuck && location === 'denied' && openAppSettings && (
            <button type="button" onClick={openAppSettings}>
              {t.settings}
            </button>
          )}
          {(status === 'none' || status === 'noRoad' || status === 'tooFar') && (
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

      {route && ways.length > 1 && (
        <div className="alts" role="radiogroup" aria-label={t.alternatives} onKeyDown={arrowRadios}>
          {ways.map((r, i) => (
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
                {/* Toll roads on the way: coins, and said for screen readers. */}
                {r.toll && (
                  <>
                    <CoinsIcon />
                    <span className="sr-only">{t.tolls}</span>
                  </>
                )}
              </small>
            </button>
          ))}
        </div>
      )}

      {transit && <TransitLegs transit={transit} lang={lang} />}
      {transit && <Tickets transit={transit} />}

      {route && !transit && (
        // Closed again for another way of travel: its steps are another list.
        <details className="steps" key={mode}>
          <summary>
            {t.steps} <small>{route.maneuvers.length}</small>
          </summary>
          <ol>
            {route.maneuvers.map((m, i) => (
              <li key={i}>
                <TurnIcon turn={turnOf(m.type)} size={18} />
                {/* The router's "You have arrived" reads as done; the list reads ahead. */}
                <span>
                  {turnOf(m.type) === 'arrive' && m.via === undefined
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
            disabled={!route || stale}
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
        onClick={(e) => {
          if (!openElsewhere) return;
          // The chooser without kOSMos; the plain link only if that fails.
          e.preventDefault();
          openElsewhere(geoUri(to, to.name), t.openIn).catch(() => {
            window.location.href = geoUri(to, to.name);
          });
        }}
      >
        {t.openIn}
      </a>
    </Sheet>
  );
}
