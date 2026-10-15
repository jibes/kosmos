import { useMemo } from 'react';
import { withScheme, type Details } from '../core/details';
import { allDay, hoursState, parseHours, weekRows, type WeekRow } from '../core/hours';
import { formatClock } from '../core/route';
import { fill, locale, t } from '../i18n';
import { useNow } from './useNow';

/** "18:00" today, "Tue 09:00" on another day. */
function when(d: Date, now: Date) {
  const clock = formatClock(d, locale);
  return d.toDateString() === now.toDateString()
    ? clock
    : `${d.toLocaleDateString(locale, { weekday: 'short' })} ${clock}`;
}

/** A Monday, to name the days of the week in the user's language. */
const day = (d: number) =>
  new Date(2024, 0, 1 + d).toLocaleDateString(locale, { weekday: 'short' });
const minute = (m: number) => formatClock(new Date(2024, 0, 1, 0, m), locale);

/** "Mon–Fri  09:00–18:00", "Sun  closed". */
function rowText(r: WeekRow) {
  const days = r.from === r.to ? day(r.from) : `${day(r.from)}–${day(r.to)}`;
  const hours = allDay(r.spans)
    ? t.allDay
    : r.spans.length
      ? r.spans.map(([s, e]) => `${minute(s)}–${minute(e)}`).join(', ')
      : t.closedDay;
  return { days, hours };
}

/** Open or closed now, and until when; the week one tap away, in the user's language. */
function Hours({ spec }: { spec: string }) {
  const now = new Date(useNow(60_000));
  // Monday first, as the rows count.
  const today = (now.getDay() + 6) % 7;
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
        {week
          ? weekRows(week).map((r) => {
              const { days, hours } = rowText(r);
              return (
                <li key={r.from} data-today={(r.from <= today && today <= r.to) || undefined}>
                  <span>{days}</span> {hours}
                </li>
              );
            })
          : // Beyond what the app reads (holidays, months, comments): shown as written.
            spec
              .split(';')
              .map((r) => r.trim())
              .filter(Boolean)
              .map((r, i) => <li key={i}>{r}</li>)}
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
