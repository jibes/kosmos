import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { formatClock, formatDistance, formatDuration } from '../core/route';
import {
  clockValue,
  departureAt,
  servedBefore,
  ticketsOf,
  vehicleOf,
  type Transit,
  type TransitLeg,
} from '../core/transit';
import { fill, t, units } from '../i18n';
import { ModeIcon, TurnIcon, VehicleIcon } from './icons';

const count = (n: number, one: string, many: string) =>
  n === 1 ? one : many.replace('{n}', `${n}`);

/** What a line badge needs: a leg of a trip, or a departure. */
export type LineOf = Pick<TransitLeg, 'mode' | 'line' | 'color' | 'textColor'>;

export const lineName = (leg: LineOf) => leg.line ?? t[`veh_${vehicleOf(leg.mode) ?? 'other'}`];

/** Buses and trams leave from a stand ("Steig"), trains from a platform ("Gleis"). */
const onRoad = (leg: LineOf) => ['bus', 'tram'].includes(vehicleOf(leg.mode) ?? '');
export const platformWord = (leg: LineOf) => (onRoad(leg) ? t.stand : t.platform);
export const sayPlatformOf = (leg: LineOf) => (onRoad(leg) ? t.sayStand : t.sayPlatform);

/** A line as people know it: its number in its own colour, with the kind of vehicle. */
export function LineChip({ leg, big }: { leg: LineOf; big?: boolean }) {
  const vehicle = vehicleOf(leg.mode);
  return (
    <span
      className="line"
      data-big={big || undefined}
      style={leg.color ? { background: leg.color, color: leg.textColor } : undefined}
    >
      {vehicle && <VehicleIcon vehicle={vehicle} size={big ? 18 : 13} />}
      {/* No line number: the icon says the vehicle, the words say it to screen readers. */}
      {leg.line ?? (vehicle ? <span className="sr-only">{lineName(leg)}</span> : lineName(leg))}
    </span>
  );
}

/** The rides of a connection as chips, or the walk when there is no ride. */
export function LineChips({ transit }: { transit: Transit }) {
  const rides = transit.legs.filter((l) => l.ride);
  if (!rides.length) {
    return (
      <span className="chips-row">
        <ModeIcon mode="foot" size={14} />
      </span>
    );
  }
  return (
    <span className="chips-row">
      {rides.map((l, i) => (
        <LineChip key={i} leg={l} />
      ))}
    </span>
  );
}

export const changesText = (transit: Transit) =>
  transit.transfers === 0 ? t.noChange : count(transit.transfers, t.oneChange, t.changes);

/** When to leave: now, or a time typed or picked; settles before asking the planner. */
export function DepartTime({
  at,
  now,
  onDepart,
}: {
  at: number | null;
  now: number;
  onDepart: (at: number | null) => void;
}) {
  const shown = clockValue(at ?? now);
  const [draft, setDraft] = useState(shown);
  const [editing, setEditing] = useState(false);
  // The parent re-renders on every fix with a new callback: the settle timer must not restart.
  const latest = useRef({ shown, onDepart });
  useEffect(() => {
    latest.current = { shown, onDepart };
  });

  // Typing 0-8-:-3-0 passes through several valid times; ask only for the one left standing.
  useEffect(() => {
    if (!editing) return;
    const id = setTimeout(() => {
      setEditing(false);
      const next = departureAt(draft, Date.now());
      if (next !== null && draft !== latest.current.shown) latest.current.onDepart(next);
    }, 800);
    return () => clearTimeout(id);
  }, [draft, editing]);

  return (
    <div className="depart">
      <label>
        {t.leave}
        <input
          type="time"
          value={editing ? draft : shown}
          onChange={(e) => {
            setEditing(true);
            setDraft(e.target.value);
          }}
        />
      </label>
      {at !== null && (
        <button type="button" onClick={() => onDepart(null)}>
          {t.now}
        </button>
      )}
    </div>
  );
}

interface LegsProps {
  transit: Transit;
  lang: string;
  /** While guiding: the leg the rider is on, with the stops behind them dimmed. */
  current?: number;
  /** Stops of the current ride already passed (of `via` plus the last). */
  passed?: number;
  /** On board the current leg's vehicle: its first stop is behind. */
  riding?: boolean;
  /** The destination's own name for the last leg; the planner calls it "END". */
  destination?: string;
}

/**
 * The connection leg by leg, all closed at first. Each ride and each walk opens to its detail:
 * every stop with its time, every turn with its street. A ride's times stand in one column,
 * its stops on a line in the line's colour, which while guiding shows how far the ride is.
 */
export function TransitLegs(props: LegsProps) {
  const { transit, lang, current, passed = 0, riding = false, destination } = props;
  const clock = (ms: number) => formatClock(new Date(ms), lang);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (i: number) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(i)) next.add(i);
      return next;
    });
  const last = transit.legs.length - 1;
  return (
    <ol className="legs">
      {transit.legs.map((l, i) => {
        const here = i === current;
        const shown = open.has(i);
        if (l.ride) {
          const summary = l.cancelled
            ? t.cancelled
            : [
                l.headsign && `→ ${l.headsign}`,
                count(l.stops + 1, t.oneStop, t.stops),
                l.delay > 0 && `${fill(t.detourMin, { n: l.delay })} ${t.late}`,
              ]
                .filter(Boolean)
                .join(' · ');
          return (
            <li
              key={i}
              className="ride"
              data-cancelled={l.cancelled || undefined}
              data-current={here || undefined}
              data-done={(current !== undefined && i < current) || undefined}
            >
              <div className="ride-head">
                <LineChip leg={l} />
                {l.via.length > 0 ? (
                  <button
                    type="button"
                    className="via"
                    aria-expanded={shown}
                    onClick={() => toggle(i)}
                  >
                    {summary}
                  </button>
                ) : (
                  <small className="via">{summary}</small>
                )}
              </div>
              <ol
                className="stops"
                style={l.color ? ({ '--leg': l.color } as CSSProperties) : undefined}
              >
                <li className="end" data-passed={(here && riding) || undefined}>
                  <time data-late={l.delay > 0 || undefined}>{clock(l.start)}</time>
                  <span>{l.from.name}</span>
                  {l.from.track && (
                    <small>
                      {platformWord(l)} {l.from.track}
                    </small>
                  )}
                </li>
                {shown &&
                  l.via.map((v, k) => {
                    // Its place among the stops served: skipped ones are passed without a stop.
                    const n = servedBefore(l, k);
                    return (
                      <li
                        key={k}
                        data-passed={(here && n < passed) || undefined}
                        data-next={(here && riding && !v.skipped && n === passed) || undefined}
                        data-skipped={v.skipped || undefined}
                      >
                        <time>{v.arrival ? clock(v.arrival) : ''}</time>
                        <span>
                          {v.name}
                          {v.skipped && <span className="sr-only"> ({t.notServed})</span>}
                        </span>
                      </li>
                    );
                  })}
                <li
                  className="end"
                  data-next={
                    (here && riding && passed >= servedBefore(l, l.via.length)) || undefined
                  }
                >
                  <time>{clock(l.end)}</time>
                  <span>{i === last && destination ? destination : l.to.name}</span>
                </li>
              </ol>
            </li>
          );
        }
        const turns = l.steps.filter((st) => st.turn !== 'depart' && st.turn !== 'straight');
        return (
          <li
            key={i}
            className="walk"
            data-current={here || undefined}
            data-done={(current !== undefined && i < current) || undefined}
          >
            <ModeIcon mode="foot" size={18} />
            <div>
              {turns.length > 0 ? (
                <button
                  type="button"
                  className="via"
                  aria-expanded={shown}
                  onClick={() => toggle(i)}
                >
                  {t.walk} {formatDuration((l.end - l.start) / 1000)} ·{' '}
                  {formatDistance(l.distance, lang, units)}
                </button>
              ) : (
                <span>
                  {t.walk} {formatDuration((l.end - l.start) / 1000)} ·{' '}
                  {formatDistance(l.distance, lang, units)}
                </span>
              )}
              {shown && (
                <ol className="stops turns">
                  {turns.map((st, k) => (
                    <li key={k}>
                      <TurnIcon turn={st.turn} size={16} />
                      <span>{st.street ?? ''}</span>
                      <small>{formatDistance(st.at, lang, units)}</small>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Where to buy tickets: each operator of the connection's rides, its own website (the timetable
 * names no booking for a given journey). Opens in the browser.
 */
export function Tickets({ transit }: { transit: Transit }) {
  const sellers = ticketsOf(transit);
  if (!sellers.length) return null;
  return (
    <p className="tickets">
      <span>{t.tickets}</span>
      {sellers.map((s) => (
        <a
          key={s.url}
          href={s.url}
          target="_blank"
          rel="noreferrer"
          aria-label={fill(t.ticketsFrom, { name: s.name })}
        >
          {s.name}
        </a>
      ))}
    </p>
  );
}

export const TransitCredit = () => (
  <a className="quiet-link" href="https://transitous.org/" target="_blank" rel="noreferrer">
    {t.transitCredit}
  </a>
);
