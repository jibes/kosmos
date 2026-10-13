import { useEffect, useState } from 'react';
import { formatClock, formatDistance, formatDuration } from '../core/route';
import { clockValue, departureAt, type Transit } from '../core/transit';
import { t } from '../i18n';
import { ModeIcon } from './icons';

const count = (n: number, one: string, many: string) =>
  n === 1 ? one : many.replace('{n}', `${n}`);

export const changesText = (transit: Transit) =>
  transit.transfers === 0 ? t.noChange : count(transit.transfers, t.oneChange, t.changes);

/** The lines of a connection, in order: "U2 · M10". */
export const linesText = (transit: Transit) =>
  transit.legs
    .filter((l) => l.ride)
    .map((l) => l.line ?? t.transit)
    .join(' · ') || t.walk;

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
            <span
              className="line"
              style={l.color ? { background: l.color, color: l.textColor } : undefined}
            >
              {l.line ?? t.transit}
            </span>
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
