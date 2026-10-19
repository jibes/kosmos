import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Point } from '../core/points';
import { fill, t } from '../i18n';
import { CloseIcon, GripIcon, LocateIcon } from './icons';

export interface PointListProps {
  /** Start to end; `null` is "my location". */
  points: Point[];
  /** Leading rows that stay where they are (guiding: "my location", the user now). */
  locked?: number;
  onMove: (from: number, to: number) => void;
  /** Absent where a point cannot come off (two left, or the last one ahead). */
  onRemove?: (index: number) => void;
  /** A tap on a point's name: another place there. Absent: names are not buttons. */
  onPick?: (index: number) => void;
  /** The start is a place: back to the live position. */
  onUseMyLocation?: () => void;
  /** Added to a stop's place in the list for its number, as the map numbers it (guiding, the
   * stops reached are no longer listed). */
  numberFrom?: number;
}

const keyOf = (p: Point, i: number, points: Point[]) => {
  // "My location" is the same point wherever it goes, live at the start or the position now.
  const id = p && !p.here ? `${p.lng},${p.lat}` : 'me';
  return `${id}#${points.slice(0, i).filter((q) => q === p).length}`;
};

/**
 * A route's points, start to end, all alike: each moved by its grip (dragged, or the arrow keys
 * on it), changed by a tap on its name, or taken off. The first is where the route starts, the
 * last where it ends; the marks say so, and number the stops as the map does.
 */
export function PointList({
  points,
  locked = 0,
  onMove,
  onRemove,
  onPick,
  onUseMyLocation,
  numberFrom = 0,
}: PointListProps) {
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ from: number; dy: number; to: number; h: number } | null>(
    null,
  );
  const startY = useRef(0);
  /** The point just moved by key: its grip keeps the focus in its new place. */
  const focusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusRef.current) return;
    list.current?.querySelector<HTMLElement>(`[data-key="${focusRef.current}"] .grip`)?.focus();
    focusRef.current = null;
  });

  const last = points.length - 1;
  const clamp = (i: number) => Math.max(locked, Math.min(last, i));

  const down = (i: number) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    const row = e.currentTarget.closest('li')!;
    const gap = parseFloat(getComputedStyle(list.current!).rowGap) || 0;
    setDrag({ from: i, dy: 0, to: i, h: row.offsetHeight + gap });
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const dy = e.clientY - startY.current;
    setDrag({ ...drag, dy, to: clamp(drag.from + Math.round(dy / drag.h)) });
  };
  /** Just dropped: the rows take their new places at once, not sliding from the old. */
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (!settling) return;
    const id = requestAnimationFrame(() => setSettling(false));
    return () => cancelAnimationFrame(id);
  }, [settling]);
  const up = () => {
    setSettling(true);
    if (drag && drag.to !== drag.from) onMove(drag.from, drag.to);
    setDrag(null);
  };
  const key = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    if (clamp(to) !== to) return;
    focusRef.current = keyOf(points[i], i, points);
    onMove(i, to);
  };

  /** Where a row shows while one is dragged: the dragged one under the finger, the others
   * making room for it. */
  const shift = (i: number) => {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.from < i && i <= drag.to) return -drag.h;
    if (drag.to <= i && i < drag.from) return drag.h;
    return 0;
  };

  return (
    <ol
      className="point-list"
      ref={list}
      aria-label={t.routePoints}
      data-settling={settling || undefined}
    >
      {points.map((p, i) => {
        const name = p && !p.here ? p.name : t.myLocation;
        const k = keyOf(p, i, points);
        const mark = i === 0 ? 'start' : i === last ? 'end' : 'stop';
        return (
          <li
            key={k}
            data-key={k}
            data-dragging={drag?.from === i || undefined}
            style={drag ? { transform: `translateY(${shift(i)}px)` } : undefined}
          >
            {i < locked ? (
              <span className="grip" aria-hidden="true" />
            ) : (
              <button
                type="button"
                className="grip"
                data-no-swipe
                aria-label={fill(t.movePoint, { name })}
                title={t.movePointHint}
                onPointerDown={down(i)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={() => setDrag(null)}
                onKeyDown={key(i)}
              >
                <GripIcon />
              </button>
            )}
            <span className="point-mark" data-mark={mark} aria-hidden="true">
              {mark === 'stop' ? i + numberFrom : ''}
            </span>
            {onPick && i >= locked ? (
              <button type="button" className="end-btn" onClick={() => onPick(i)}>
                {name}
              </button>
            ) : (
              <span className="end-btn">{name}</span>
            )}
            {i === 0 && p && onUseMyLocation && (
              <button
                type="button"
                className="icon-btn"
                aria-label={t.useMyLocation}
                title={t.useMyLocation}
                onClick={onUseMyLocation}
              >
                <LocateIcon />
              </button>
            )}
            {onRemove && i >= locked && (
              <button
                type="button"
                className="icon-btn"
                aria-label={fill(t.removePoint, { name })}
                onClick={() => onRemove(i)}
              >
                <CloseIcon size={16} />
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
