import { useEffect, useRef, useState } from 'react';
import { TRIP_KINDS } from '../core/alongRoute';
import type { Category } from '../core/categories';
import { formatDistance, type Mode, type Route } from '../core/route';
import type { Place } from '../core/search';
import { fill, t, units } from '../i18n';
import type { AlongPlace } from './categorySearch';
import { KindIcon } from './icons';
import { logEvent } from './usageLog';

export interface AlongSearch {
  /** Places of a kind along the rest of `route` from `from` metres (`findAlong`). */
  find: (route: Route, mode: Mode, from: number, kind: Category) => Promise<AlongPlace[] | null>;
  /** A stop by way of the place; absent while no more can be added. */
  onAdd?: (place: Place) => void;
}

interface Props extends AlongSearch {
  route: Route;
  mode: Mode;
  /** Metres along the route the user is now (0 before setting off). */
  from: number;
  lang: string;
  /** Its own heading (the guidance panel); the route card's fold names it instead. */
  heading?: boolean;
}

type Found = { kind: Category; from: number; hits: AlongPlace[] } | 'loading' | 'failed' | null;

/**
 * Fuel, a toilet, a coffee on the way: a kind of place, then those along the rest of the route,
 * nearest along the way first, each with its detour and a way to make it a stop. The distances
 * count on as the trip goes on; places passed drop off.
 */
export function AlongRoute({ route, mode, from, lang, find, onAdd, heading = true }: Props) {
  const [kind, setKind] = useState<Category | null>(null);
  const [found, setFound] = useState<Found>(null);
  const fromRef = useRef(from);
  useEffect(() => {
    fromRef.current = from;
  });
  useEffect(() => {
    if (!kind) return;
    let live = true;
    let done = false;
    const at = fromRef.current;
    // Said to be loading only while it is: tiles read before answer at once.
    const id = requestAnimationFrame(() => live && !done && setFound('loading'));
    find(route, mode, at, kind)
      .then((hits) => {
        done = true;
        if (!live) return;
        setFound(hits ? { kind, from: at, hits } : 'failed');
        logEvent('along.search', { kind, n: hits?.length ?? -1 });
      })
      .catch(() => {
        done = true;
        if (live) setFound('failed');
      });
    return () => {
      live = false;
      cancelAnimationFrame(id);
    };
  }, [kind, route, mode, find]);

  const shown =
    found && typeof found === 'object' && found.kind === kind
      ? found.hits
          .map((h) => ({ ...h, ahead: h.ahead + found.from - from }))
          .filter((h) => h.ahead > -20)
      : [];
  const minutes = (s: number) => Math.max(1, Math.round(s / 60));

  return (
    <section className="along" aria-label={t.alongWay}>
      {heading && <h3>{t.alongWay}</h3>}
      <div className="along-kinds">
        {TRIP_KINDS.map((c) => (
          <button
            key={c}
            type="button"
            className="chip"
            aria-pressed={kind === c}
            onClick={() => setKind(kind === c ? null : c)}
          >
            {t[`cat_${c}`]}
          </button>
        ))}
      </div>
      {kind && (
        <ul className="along-list" aria-live="polite">
          {found === 'loading' && <li className="r-empty r-loading" aria-label={t.routing} />}
          {found === 'failed' && <li className="r-empty">{t.alongFailed}</li>}
          {found && typeof found === 'object' && !shown.length && (
            <li className="r-empty">{t.noneAlong}</li>
          )}
          {shown.map(({ place, ahead, detour }) => {
            const line = [
              fill(t.alongIn, { d: formatDistance(Math.max(0, ahead), lang, units) }),
              detour ? fill(t.detourMin, { n: minutes(detour) }) : t.onTheWay,
            ].join(' · ');
            return (
              <li key={`${place.name}${place.lat}${place.lng}`}>
                <KindIcon kind={place.kind ?? 'place'} />
                <span className="r-name">{place.name}</span>
                <span className="r-detail">{line}</span>
                {onAdd && (
                  <button
                    type="button"
                    className="chip along-add"
                    aria-label={fill(t.addAsStop, { name: place.name })}
                    onClick={() => onAdd(place)}
                  >
                    {t.addStop}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
