import type * as maplibregl from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { LocateIcon, NeedleIcon, NoLocationIcon } from './icons';
import type { LocationStatus } from './useLocation';

interface Props {
  map: maplibregl.Map | null;
  status: LocationStatus;
  following: boolean;
  onLocate: () => void;
}

export function Controls({ map, status, following, onLocate }: Props) {
  const [camera, setCamera] = useState({ bearing: 0, pitch: 0 });

  useEffect(() => {
    if (!map) return;
    const sync = () => setCamera({ bearing: map.getBearing(), pitch: map.getPitch() });
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
        : t.locate;

  return (
    <div className="controls">
      <button
        type="button"
        className="ctl surface compass"
        data-hidden={!tilted || undefined}
        aria-label={t.resetNorth}
        tabIndex={tilted ? 0 : -1}
        onClick={() => map?.easeTo({ bearing: 0, pitch: 0, duration: 500 })}
      >
        <span
          style={{
            transform: `rotateX(${camera.pitch * 0.6}deg) rotate(${-camera.bearing}deg)`,
          }}
        >
          <NeedleIcon />
        </span>
      </button>
      <button
        type="button"
        className="ctl surface"
        aria-label={label}
        title={label}
        aria-pressed={following}
        data-state={status}
        data-following={following || undefined}
        onClick={onLocate}
      >
        {blocked ? <NoLocationIcon /> : <LocateIcon filled={following} />}
      </button>
    </div>
  );
}
