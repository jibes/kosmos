import type * as maplibregl from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { CompassModeIcon, LocateIcon, NeedleIcon, NoLocationIcon } from './icons';
import type { LocationStatus } from './useLocation';

/** Off; follow the position north-up; follow and turn the map with the compass. */
export type Follow = 'off' | 'position' | 'compass';

interface Props {
  map: maplibregl.Map | null;
  status: LocationStatus;
  follow: Follow;
  onLocate: () => void;
  onNorth: () => void;
}

export function Controls({ map, status, follow, onLocate, onNorth }: Props) {
  const [camera, setCamera] = useState({ bearing: 0, pitch: 0 });

  useEffect(() => {
    if (!map) return;
    // Whole degrees: compass mode turns the map every frame, the button need not redraw as often.
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

  const tilted = Math.abs(camera.bearing) > 0.5 || camera.pitch > 0.5;
  const blocked = status === 'denied' || status === 'unavailable';
  const label =
    status === 'denied'
      ? t.locationDenied
      : status === 'unavailable'
        ? t.locationUnavailable
        : follow === 'position'
          ? t.followCompass
          : follow === 'compass'
            ? t.northUp
            : t.locate;
  const following = follow !== 'off';

  return (
    <div className="controls">
      <button
        type="button"
        className="ctl surface"
        aria-label={label}
        title={label}
        data-state={status}
        data-following={following || undefined}
        data-follow={follow}
        onClick={onLocate}
      >
        {blocked ? (
          <NoLocationIcon />
        ) : follow === 'compass' ? (
          <CompassModeIcon />
        ) : (
          <LocateIcon filled={following} />
        )}
      </button>
      <button
        type="button"
        className="ctl surface compass"
        data-hidden={!tilted || undefined}
        aria-hidden={!tilted || undefined}
        aria-label={t.resetNorth}
        tabIndex={tilted ? 0 : -1}
        onClick={onNorth}
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
