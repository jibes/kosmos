import { useEffect, useState } from 'react';
import { formatClock, formatDistance, formatDuration } from '../core/route';
import { clockValue, departureAt, vehicleOf, type Transit, type TransitLeg } from '../core/transit';
import { t } from '../i18n';
import { ModeIcon, VehicleIcon } from './icons';

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

/** The connection leg by leg: walks as one line, each ride with its line, stops and times. */
export function TransitLegs({ transit, lang }: { transit: Transit; lang: string }) {
  const clock = (ms: number) => formatClock(new Date(ms), lang);
  return (
    <ol className="legs">
      {transit.legs.map((l, i) =>
        l.ride ? (
          <li key={i} className="ride" data-cancelled={l.cancelled || undefined}>
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
              <small className="via">
                {l.cancelled
                  ? t.cancelled
                  : [
                      l.headsign && `→ ${l.headsign}`,
                      count(l.stops + 1, t.oneStop, t.stops),
                      l.delay > 0 && `+${l.delay} min ${t.late}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
              </small>
              <p>
                <time>{clock(l.end)}</time>
                <span>{l.to.name}</span>
              </p>
            </div>
          </li>
        ) : (
          <li key={i} className="walk">
            <ModeIcon mode="foot" size={18} />
            <span>
              {t.walk} {formatDuration((l.end - l.start) / 1000)} ·{' '}
              {formatDistance(l.distance, lang)}
            </span>
          </li>
        ),
      )}
    </ol>
  );
}

export const TransitCredit = () => (
  <a className="quiet-link" href="https://transitous.org/" target="_blank" rel="noreferrer">
    {t.transitCredit}
  </a>
);
