import { useRef, useState, type ReactNode } from 'react';
import { useSwipe } from './useSwipe';

/** Past this, or with a quick flick, a pull up closes the trip list. */
const CLOSE_PX = 64;
const FLICK_PX_PER_MS = 0.5;

/**
 * What lies ahead, opened under the guidance banner: the whole public transport trip, or the
 * road route's coming steps. Pulled up from anywhere on it, once its list is scrolled to the
 * end, it folds away again (Back does too).
 */
export function TripDetails({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const el = useRef<HTMLElement>(null);
  const [dy, setDy] = useState(0);
  useSwipe(
    el,
    () => ({ dir: -1, scrollFirst: true }),
    (raw) => setDy(raw < 0 ? raw : raw * 0.2),
    (dist, v) => {
      setDy(0);
      if (dist < -CLOSE_PX || v < -FLICK_PX_PER_MS) onClose();
    },
  );
  return (
    <section
      ref={el}
      className="ride-details surface"
      data-dragging={dy !== 0 || undefined}
      style={dy ? { transform: `translateY(${dy}px)` } : undefined}
    >
      {children}
    </section>
  );
}
