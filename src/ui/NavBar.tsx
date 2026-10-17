import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { LocateIcon, RouteIcon } from './icons';
import { touch } from './layout';

export const SoundIcon = ({ off }: { off: boolean }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" />
    {off ? (
      <path d="m16 9.5 5 5m0-5-5 5" />
    ) : (
      <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
    )}
  </svg>
);

/** How long End waits for its second tap. */
const ARM_MS = 3000;

interface Props {
  /** Arrival time and what is left. */
  children: ReactNode;
  muted: boolean;
  arrived: boolean;
  onMute: () => void;
  onEnd: () => void;
}

/**
 * The bottom bar of guidance: time left, mute, and End. End next to Mute must not end a trip by
 * a slip of the thumb, so it asks for a second tap; once arrived it is a plain "Done".
 */
export function NavBar({ children, muted, arrived, onMute, onEnd }: Props) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(id);
  }, [armed]);

  return (
    <section className="nav-bar surface">
      <div className="nav-eta">{children}</div>
      <button
        type="button"
        className="icon-btn round big"
        aria-label={t.mute}
        aria-pressed={muted}
        onClick={onMute}
      >
        <SoundIcon off={muted} />
      </button>
      <button
        type="button"
        className="nav-end"
        data-state={arrived ? 'done' : armed ? 'armed' : undefined}
        aria-label={
          armed && !arrived ? (touch() ? t.endConfirmHint : t.endConfirmHintClick) : undefined
        }
        onClick={() => (arrived || armed ? onEnd() : setArmed(true))}
      >
        {arrived ? t.done : armed ? t.endConfirm : t.end}
      </button>
    </section>
  );
}

interface ToggleProps {
  following: boolean;
  overview: boolean;
  onFollow: () => void;
  onOverview: () => void;
}

/**
 * The one control for the view while guiding: the rest of the way while the camera follows
 * close, and back to following from the overview or after looking around.
 */
export function ViewToggle({ following, overview, onFollow, onOverview }: ToggleProps) {
  if (following && !overview) {
    return (
      <button
        type="button"
        className="overview surface"
        aria-label={t.overview}
        title={t.overview}
        onClick={onOverview}
      >
        <RouteIcon />
      </button>
    );
  }
  return (
    <button type="button" className="recenter surface" onClick={onFollow}>
      <LocateIcon filled />
      {t.recenter}
    </button>
  );
}
