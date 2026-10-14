import { useMemo } from 'react';
import { withScheme, type Details } from '../core/details';
import { hoursState, parseHours } from '../core/hours';
import { formatClock } from '../core/route';
import { fill, lang, t } from '../i18n';
import { useNow } from './useNow';

/** "18:00" today, "Tue 09:00" on another day. */
function when(d: Date, now: Date) {
  const clock = formatClock(d, lang);
  return d.toDateString() === now.toDateString()
    ? clock
    : `${d.toLocaleDateString(lang, { weekday: 'short' })} ${clock}`;
}

/** Open or closed now, and until when; the hours as written one tap away. */
function Hours({ spec }: { spec: string }) {
  const now = new Date(useNow(60_000));
  const week = useMemo(() => parseHours(spec), [spec]);
  const st = week && hoursState(week, now);
  let status = t.openingHours;
  if (st && 'always' in st && st.always) status = t.open247;
  else if (st && 'never' in st) status = t.closedNow;
  else if (st && 'change' in st)
    status = fill(st.open ? t.openUntil : t.closedUntil, { time: when(st.change, now) });
  return (
    <details className="hours">
      <summary data-open={st ? st.open : undefined}>{status}</summary>
      <ul>
        {spec
          .split(';')
          .map((r) => r.trim())
          .filter(Boolean)
          .map((r, i) => (
            <li key={i}>{r}</li>
          ))}
      </ul>
    </details>
  );
}

/** Opening hours, phone and website, as far as OpenStreetMap knows them. */
export function PlaceDetails({ details }: { details: Details }) {
  const { hours, phone, website } = details;
  if (!hours && !phone && !website) return null;
  return (
    <div className="place-details">
      {hours && <Hours spec={hours} />}
      {(phone || website) && (
        <p className="contacts">
          {phone && <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{phone}</a>}
          {website && (
            <a href={withScheme(website)} target="_blank" rel="noreferrer">
              {
                website
                  .replace(/^https?:\/\//i, '')
                  .replace(/^www\./, '')
                  .split('/')[0]
              }
            </a>
          )}
        </p>
      )}
    </div>
  );
}
