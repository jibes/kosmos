import { formatClock } from '../core/route';
import type { Place } from '../core/search';
import { locale, t } from '../i18n';
import { LineChip, platformWord } from './TransitParts';
import { useDepartures } from './useDepartures';

/** A stop's next departures on its card: when, which line, where to, from which platform. */
export function Departures({ place, lang }: { place: Place; lang: string }) {
  const list = useDepartures(place, lang);
  if (!place.stop) return null;
  return (
    <section className="departures" aria-label={t.departures} aria-busy={list === undefined}>
      <h3>{t.departures}</h3>
      {list === undefined ? (
        <p className="shimmer" aria-hidden="true" />
      ) : list === null ? (
        <p className="departures-note">{t.departuresUnavailable}</p>
      ) : !list.length ? (
        <p className="departures-note">{t.noDepartures}</p>
      ) : (
        <ol>
          {list.map((d) => (
            <li key={`${d.line}${d.headsign}${d.time}`} data-cancelled={d.cancelled || undefined}>
              <time data-late={d.delay > 0 || undefined}>
                {formatClock(new Date(d.time), locale)}
              </time>
              <LineChip leg={d} />
              <span className="departures-to">
                {d.cancelled ? `${d.headsign ?? ''} · ${t.cancelled}` : (d.headsign ?? '')}
              </span>
              {d.track && (
                <small data-moved={d.moved || undefined}>
                  {platformWord(d)} {d.track}
                </small>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
