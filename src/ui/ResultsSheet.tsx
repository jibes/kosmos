import { formatDistance } from '../core/route';
import type { Place } from '../core/search';
import { fill, t, units } from '../i18n';
import { wide } from './layout';
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
}

/**
 * The places a search put on the map, as a list by distance: on a phone a strip at first
 * ("Restaurants · 12 · nearest 120 m"), so the map comes first; pulled up, or tapped, the
 * list. Beside the map in the side layout it is open.
 */
export function ResultsSheet({ label, places, failed, lang, onPick, hidden }: Props) {
  const nearest = places?.[0]?.distance;
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
            : fill(t.resultsCount, { n: places.length })
          : fill(t.resultsPeek, {
              n: places.length,
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
          {places.map((p) => (
            <li key={`${p.name}${p.lat}${p.lng}`}>
              <button type="button" onClick={() => onPick(p)}>
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
