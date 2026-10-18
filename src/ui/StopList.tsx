import type { Place } from '../core/search';
import { fill, t } from '../i18n';
import { CloseIcon, UpIcon } from './icons';

export interface StopListProps {
  /** The trip's stops (`Trip.via`). */
  via: Place[];
  /** Those before this are reached, guiding: shown no more, never moved past. */
  first?: number;
  onMoveUp: (index: number) => void;
  onRemove: (index: number) => void;
}

/**
 * The stops still ahead, in order, each with its number as on the map: a place earlier, or off
 * the trip. The route card and the guidance's steps panel both list them.
 */
export function StopList({ via, first = 0, onMoveUp, onRemove }: StopListProps) {
  if (via.length <= first) return null;
  return (
    <ol className="stop-list" aria-label={t.stopsOnTheWay}>
      {via.map((v, i) =>
        i < first ? null : (
          <li key={`${v.lng},${v.lat},${i}`}>
            <span className="stop-num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="stop-name">{v.name}</span>
            {i > first && (
              <button
                type="button"
                className="icon-btn"
                aria-label={fill(t.moveStopUp, { name: v.name })}
                title={t.moveUp}
                onClick={() => onMoveUp(i)}
              >
                <UpIcon />
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label={fill(t.removeStop, { name: v.name })}
              onClick={() => onRemove(i)}
            >
              <CloseIcon size={16} />
            </button>
          </li>
        ),
      )}
    </ol>
  );
}
