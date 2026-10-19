import type * as maplibregl from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { LocateIcon, NeedleIcon, NoLocationIcon, WholeRouteIcon } from './icons';
import type { LocationStatus } from './useLocation';

/** Off; follow the position (north up, or as turned by hand); follow heading-up. */
export type Follow = 'off' | 'position' | 'compass';

interface Props {
  map: maplibregl.Map | null;
  status: LocationStatus;
  follow: Follow;
  /** Following: back to the user. Not following: follow. */
  onLocate: () => void;
  /** Which way is up: heading-up, north up, or north again after a hand turned the map. */
  onTurn: () => void;
  /** Heading-up is possible (a compass, or guidance's own course). */
  canTurn: boolean;
  /** Guiding: heading-up turns the map with the way, not the phone. */
  guiding?: boolean;
  /**
   * A route is open or guided: following, the location button's next tap shows the whole of
   * it (and the one after comes back to the user).
   */
  route?: boolean;
  /** Guiding: the rest of the way is on screen. */
  overview?: boolean;
}

/**
 * The map's two buttons, one job each, the same on the map and while guiding: the location
 * button says what the camera tracks (the user, pressed while it does; with a route, the user or
 * the whole route in turn); the needle says which way is up and switches north up and
 * heading-up. Zoom and tilt never stop following; a drag does.
 */
export function Controls(props: Props) {
  const { map, status, follow, onLocate, onTurn, canTurn, guiding, route, overview } = props;
  const [camera, setCamera] = useState({ bearing: 0, pitch: 0 });

  useEffect(() => {
    if (!map) return;
    // Whole degrees: heading-up turns the map every frame, the needle need not redraw as often.
    const sync = () => {
      const next = { bearing: Math.round(map.getBearing()), pitch: Math.round(map.getPitch()) };
      setCamera((c) => (c.bearing === next.bearing && c.pitch === next.pitch ? c : next));
    };
    map.on('rotate', sync);
    map.on('pitch', sync);
    sync();
    return () => {
      map.off('rotate', sync);
      map.off('pitch', sync);
    };
  }, [map]);

  const turned = Math.abs(camera.bearing) > 0.5 || camera.pitch > 0.5;
  const heading = follow === 'compass';
  const following = follow !== 'off' && !overview;
  const blocked = status === 'denied' || status === 'unavailable';
  // With a route, the button names its next step: following, the whole route; else the user.
  const toRoute = !!route && following && !blocked;
  const locateLabel =
    status === 'denied'
      ? t.locationDenied
      : status === 'unavailable'
        ? t.locationUnavailable
        : toRoute
          ? t.wholeRoute
          : t.locate;
  // The needle names what a tap does: north up from heading-up or a hand's turn, else heading-up.
  const toNorth = heading || turned;
  const turnLabel = toNorth ? t.northUp : guiding ? t.followHeading : t.followCompass;
  const showTurn = toNorth || (canTurn && (following || !!guiding));

  return (
    <div className="controls">
      <button
        type="button"
        className="ctl surface"
        aria-label={locateLabel}
        title={locateLabel}
        aria-pressed={blocked || route ? undefined : following}
        data-state={status}
        data-following={following || undefined}
        data-follow={follow}
        onClick={onLocate}
      >
        {blocked ? (
          <NoLocationIcon />
        ) : toRoute ? (
          <WholeRouteIcon />
        ) : (
          <LocateIcon filled={following && !route} />
        )}
      </button>
      <button
        type="button"
        className="ctl surface compass"
        data-hidden={!showTurn || undefined}
        data-heading={heading || undefined}
        aria-hidden={!showTurn || undefined}
        aria-label={turnLabel}
        title={turnLabel}
        tabIndex={showTurn ? 0 : -1}
        onClick={onTurn}
      >
        <span
          style={{
            transform: `rotateX(${camera.pitch * 0.6}deg) rotate(${-camera.bearing}deg)`,
          }}
        >
          <NeedleIcon />
        </span>
      </button>
    </div>
  );
}
