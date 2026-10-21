import { useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { t } from '../i18n';
import { useSwipe } from './useSwipe';

interface Props {
  className: string;
  /** One line shown while minimised, e.g. the place name or the route time. */
  peek: ReactNode;
  children: ReactNode;
  busy?: boolean;
  /** Starts as the strip (the search results: the map first). */
  startMin?: boolean;
  /** Kept in the page but out of sight, its state and all (a place card open over it). */
  hidden?: boolean;
  label?: string;
}

/** Past this, or with a quick flick, a drag minimises (or restores) the sheet. */
const THRESHOLD_PX = 64;
const FLICK_PX_PER_MS = 0.5;

/**
 * A card that can be pulled down to a one-line strip for a bigger map, and pulled up (or tapped)
 * back. A finger drags it from anywhere on it (`useSwipe`: lists inside scroll first, taps stay
 * taps); a mouse from its grab bar.
 */
export function Sheet({ className, peek, children, busy, startMin, hidden, label }: Props) {
  const [min, setMin] = useState(!!startMin);
  const [dy, setDy] = useState(0);
  const drag = useRef<{ y: number; t: number; moved: boolean } | null>(null);
  const el = useRef<HTMLElement>(null);

  /** Follow the finger in the useful direction; resist the other way. */
  const follow = (raw: number) => setDy(min ? Math.min(raw, 0) * 0.6 : raw > 0 ? raw : raw * 0.2);
  /** Let go: far or fast enough the useful way, and it changes. */
  const settle = (dist: number, v: number) => {
    setDy(0);
    if (!min && (dist > THRESHOLD_PX || v > FLICK_PX_PER_MS)) setMin(true);
    else if (min && (dist < -THRESHOLD_PX / 2 || v < -FLICK_PX_PER_MS)) setMin(false);
  };
  useSwipe(
    el,
    () => (min ? { dir: -1, scrollFirst: false } : { dir: 1, scrollFirst: true }),
    follow,
    settle,
  );

  const dragged = useRef(false);
  const down = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, t: e.timeStamp, moved: false };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const raw = e.clientY - d.y;
    if (Math.abs(raw) > 4) d.moved = true;
    follow(raw);
  };
  const up = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setDy(0);
    if (!d) return;
    const dist = e.clientY - d.y;
    // A tap is the click below; a drag is not one.
    dragged.current = d.moved;
    if (d.moved) settle(dist, dist / Math.max(1, e.timeStamp - d.t));
  };

  return (
    <section
      ref={el}
      className={`${className} sheet`}
      hidden={hidden}
      aria-label={label}
      data-min={min || undefined}
      data-dragging={dy !== 0 || undefined}
      style={dy ? { transform: `translateY(${dy}px)` } : undefined}
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
        // A click, as a tap, a key and a screen reader all send one.
        onClick={() => {
          if (dragged.current) dragged.current = false;
          else setMin((m) => !m);
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
