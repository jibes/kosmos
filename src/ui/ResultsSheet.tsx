import { useEffect, useState } from 'react';
import { SHOWN_MAX } from '../core/categories';
import { formatDistance } from '../core/route';
import type { Place } from '../core/search';
import { fill, t, units } from '../i18n';
import { wide } from './layout';
import { KindIcon } from './icons';
import { Sheet } from './Sheet';

interface Props {
  /** What is shown, as the search field names it ("Restaurants", "MediaMarkt"). */
  label: string;
  /** The places on the map, nearest first; `null` while they are still being read. */
  places: Place[] | null;
  failed?: boolean;
  lang: string;
  onPick: (place: Place) => void;
  /** A place card is open over it: the sheet waits, as it was, until the card closes. */
  hidden: boolean;
  /** The place whose card is open (from a row or a dot), marked in the list from then on. */
  opened: Place | null;
  /** Lights up the dot of the `index`th place on the map; `null` puts it back. */
  onHighlight: (index: number | null) => void;
}

/** The same place: by name, and its point within about 2 m (a dot's point comes back from the
 * map's tiles a little rounded). */
const same = (a: Place, b: Place) =>
  a.name === b.name && Math.abs(a.lat - b.lat) < 2e-5 && Math.abs(a.lng - b.lng) < 2e-5;

/**
 * The places a search put on the map, as a list by distance: on a phone a strip at first
 * ("Restaurants · 12 · nearest 120 m"), so the map comes first; pulled up, or tapped, the
 * list. Beside the map in the side layout it is open.
 */
export function ResultsSheet({
  label,
  places,
  failed,
  lang,
  onPick,
  hidden,
  opened,
  onHighlight,
}: Props) {
  /** The row under a finger or the pointer, and the one opened last. */
  const [held, setHeld] = useState<number | null>(null);
  const [marked, setMarked] = useState<Place | null>(null);
  if (opened && opened !== marked && places?.some((p) => same(p, opened))) setMarked(opened);
  const markedAt = marked ? (places?.findIndex((p) => same(p, marked)) ?? -1) : -1;
  // The dot of the row held, else of the place opened last.
  const lit = held ?? (markedAt >= 0 ? markedAt : null);
  useEffect(() => {
    onHighlight(lit);
  }, [lit, onHighlight]);
  useEffect(() => () => onHighlight(null), [onHighlight]);

  const nearest = places?.[0]?.distance;
  // Cut off at the nearest so many: "60+", as more lie further out.
  const n = places && places.length >= SHOWN_MAX ? `${places.length}+` : places?.length;
  const beyond = !!places?.length && places.every((p) => p.beyond);
  const summary = failed
    ? navigator.onLine
      ? t.searchSlow
      : t.searchOffline
    : !places
      ? t.searching
      : !places.length
        ? t.noneHere
        : nearest === undefined
          ? places.length === 1
            ? t.oneResult
            : fill(t.resultsCount, { n: n! })
          : fill(t.resultsPeek, {
              n: n!,
              d: formatDistance(nearest, lang, units),
            });

  return (
    <Sheet
      className="results-sheet surface"
      startMin={!wide()}
      hidden={hidden}
      label={t.resultsList}
      busy={!places && !failed}
      peek={
        <>
          <strong>{label}</strong>
          <span>{summary}</span>
        </>
      }
    >
      <h2 className="results-title">
        {label}
        <span>{summary}</span>
      </h2>
      {beyond && <p className="results-note">{t.beyondView}</p>}
      {!!places?.length && (
        <ul className="results-list">
          {places.map((p, i) => (
            <li key={`${p.name}${p.lat}${p.lng}`} data-marked={i === markedAt || undefined}>
              <button
                type="button"
                aria-current={i === markedAt || undefined}
                onClick={() => onPick(p)}
                onPointerEnter={() => setHeld(i)}
                onPointerDown={() => setHeld(i)}
                onPointerLeave={() => setHeld(null)}
                onPointerCancel={() => setHeld(null)}
                onPointerUp={(e) => e.pointerType !== 'mouse' && setHeld(null)}
                onFocus={() => setHeld(i)}
                onBlur={() => setHeld(null)}
              >
                <KindIcon kind={p.kind ?? 'place'} />
                <span className="r-name">{p.name}</span>
                <span className="r-detail">
                  {p.distance !== undefined ? formatDistance(p.distance, lang, units) : p.detail}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
