import { useEffect, useState } from 'react';
import { formatClock, formatDistance, formatDuration } from '../core/route';
import { clockValue, departureAt, vehicleOf, type Transit, type TransitLeg } from '../core/transit';
import { t, units } from '../i18n';
import { ModeIcon, TurnIcon, VehicleIcon } from './icons';

const count = (n: number, one: string, many: string) =>
  n === 1 ? one : many.replace('{n}', `${n}`);

/** A line as people know it: its number in its own colour, with the kind of vehicle. */
export function LineChip({ leg, big }: { leg: TransitLeg; big?: boolean }) {
  const vehicle = vehicleOf(leg.mode);
  return (
    <span
      className="line"
      data-big={big || undefined}
      style={leg.color ? { background: leg.color, color: leg.textColor } : undefined}
    >
      {vehicle && <VehicleIcon vehicle={vehicle} size={big ? 18 : 13} />}
      {leg.line ?? t.transit}
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

  // Typing 0-8-:-3-0 passes through several valid times; ask only for the one left standing.
  useEffect(() => {
    if (!editing) return;
    const id = setTimeout(() => {
      setEditing(false);
      const next = departureAt(draft, Date.now());
      if (next !== null && draft !== shown) onDepart(next);
    }, 800);
    return () => clearTimeout(id);
  }, [draft, editing, shown, onDepart]);

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
  /** While riding: the leg the rider is on, opened, with the stops behind them dimmed. */
  current?: number;
  /** Stops of the current ride already passed (of `via` plus the last). */
  passed?: number;
  /** The destination's own name for the last leg; the planner calls it "END". */
  destination?: string;
}

/**
 * The connection leg by leg. Each ride and each walk opens to its detail: every stop with its
 * time, every turn with its street.
 */
export function TransitLegs({ transit, lang, current, passed = 0, destination }: LegsProps) {
  const clock = (ms: number) => formatClock(new Date(ms), lang);
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(current === undefined ? [] : [current]),
  );
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
                l.delay > 0 && `+${l.delay} min ${t.late}`,
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
              <LineChip leg={l} />
              <div>
                <p>
                  <time data-late={l.delay > 0 || undefined}>{clock(l.start)}</time>
                  <span>{l.from.name}</span>
                  {l.from.track && (
                    <small>
                      {t.platform} {l.from.track}
                    </small>
                  )}
                </p>
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
                {shown && (
                  <ol className="stops">
                    {l.via.map((v, k) => (
                      <li key={k} data-passed={(here && k < passed) || undefined}>
                        <time>{v.arrival ? clock(v.arrival) : ''}</time>
                        <span>{v.name}</span>
                      </li>
                    ))}
                  </ol>
                )}
                <p>
                  <time>{clock(l.end)}</time>
                  <span>{i === last && destination ? destination : l.to.name}</span>
                </p>
              </div>
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

export const TransitCredit = () => (
  <a className="quiet-link" href="https://transitous.org/" target="_blank" rel="noreferrer">
    {t.transitCredit}
  </a>
);
