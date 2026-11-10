import { useCallback, useState } from 'react';
import type { Place } from '../core/search';
import { lang, t } from '../i18n';
import { Departures } from './Departures';
import { CloseIcon } from './icons';
import { PlaceDetails } from './PlaceDetails';
import { PlacePhoto } from './PlacePhoto';
import { TripDetails } from './TripDetails';
import type { Enrich } from './useMapTaps';
import { usePlaceDetails } from './usePlaceDetails';

/**
 * A place's details while guiding, a label tapped on the way (Details in its note): opening
 * hours, phone, website, photo, departures, in the panel under the banner, as the trip list
 * opens. Guidance goes on; nothing else of the place card (Route, Nearby) belongs on a trip.
 */
export function useNavPlace(navigating: boolean) {
  const [shown, setShown] = useState<{ place: Place; loading: boolean } | null>(null);
  if (shown && !navigating) setShown(null);
  const show = useCallback((place: Place, enrich?: Enrich) => {
    setShown({ place, loading: !!enrich });
    enrich?.()
      .catch(() => null)
      .then((extra) =>
        setShown((now) =>
          now?.place === place ? { place: { ...place, ...extra }, loading: false } : now,
        ),
      );
  }, []);
  const close = useCallback(() => setShown(null), []);
  return { shown, show, close };
}

export function NavPlace({
  place,
  loading,
  onClose,
}: {
  place: Place;
  loading: boolean;
  onClose: () => void;
}) {
  const details = usePlaceDetails(place.osm, lang);
  return (
    <TripDetails onClose={onClose}>
      <div className="nav-place">
        <header>
          <div className="card-title">
            <h2>{place.name}</h2>
            {place.detail ? (
              <p>{place.detail}</p>
            ) : (
              loading && <p className="shimmer" aria-hidden="true" />
            )}
          </div>
          <button type="button" className="icon-btn round" aria-label={t.close} onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </header>
        <PlacePhoto photo={details?.photo} name={place.name} />
        {details && <PlaceDetails details={details} lng={place.lng} />}
        <Departures place={place} lang={lang} />
      </div>
    </TripDetails>
  );
}
