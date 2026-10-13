import { useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { t } from '../i18n';

interface Props {
  className: string;
  /** One line shown while minimised, e.g. the place name or the route time. */
  peek: ReactNode;
  children: ReactNode;
  busy?: boolean;
}

/** Past this, or with a quick flick, a drag minimises (or restores) the sheet. */
const THRESHOLD_PX = 64;
const FLICK_PX_PER_MS = 0.5;

/**
 * A card that can be pulled down to a one-line strip for a bigger map, and pulled up (or tapped)
 * back. Dragging starts only on the grab bar, so lists inside keep scrolling normally.
 */
export function Sheet({ className, peek, children, busy }: Props) {
  const [min, setMin] = useState(false);
  const [dy, setDy] = useState(0);
  const drag = useRef<{ y: number; t: number; moved: boolean } | null>(null);

  const down = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, t: e.timeStamp, moved: false };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const raw = e.clientY - d.y;
    if (Math.abs(raw) > 4) d.moved = true;
    // Follow the finger in the useful direction; resist the other way.
    setDy(min ? Math.min(raw, 0) * 0.6 : raw > 0 ? raw : raw * 0.2);
  };
  const up = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setDy(0);
    if (!d) return;
    const dist = e.clientY - d.y;
    const v = dist / Math.max(1, e.timeStamp - d.t);
    if (!d.moved) setMin((m) => !m);
    else if (!min && (dist > THRESHOLD_PX || v > FLICK_PX_PER_MS)) setMin(true);
    else if (min && (dist < -THRESHOLD_PX / 2 || v < -FLICK_PX_PER_MS)) setMin(false);
  };

  return (
    <section
      className={`${className} sheet`}
      data-min={min || undefined}
      data-dragging={dy !== 0 || undefined}
      style={dy ? { transform: `translateY(${dy}px)` } : undefined}
      aria-live="polite"
      aria-busy={busy}
    >
      <button
        type="button"
        className="grab"
        aria-label={min ? t.expand : t.minimize}
        aria-expanded={!min}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          drag.current = null;
          setDy(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setMin((m) => !m);
          }
        }}
      >
        <span />
      </button>
      {min ? (
        <button type="button" className="peek" onClick={() => setMin(false)}>
          {peek}
        </button>
      ) : (
        children
      )}
    </section>
  );
}
