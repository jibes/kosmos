import { useState } from 'react';
import { formatLngLat, osmUrl, plainLngLat } from '../core/geo';
import type { Place } from '../core/search';
import { lang, locale, t } from '../i18n';
import { focusSearch, useFocusOnMount } from './a11y';
import { CloseIcon, CopyIcon, NearbyIcon, RouteIcon, ShareIcon } from './icons';
import { copy, share } from './native';
import { PlaceDetails } from './PlaceDetails';
import { Sheet } from './Sheet';
import { usePlaceDetails } from './usePlaceDetails';

interface Props {
  place: Place;
  loading: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
  onRoute: () => void;
  /** Search around this place: the map goes there and the search field opens. */
  onNearby: () => void;
}

export function PlaceCard({ place, loading, onClose, onToast, onRoute, onNearby }: Props) {
  const [copied, setCopied] = useState(false);
  const details = usePlaceDetails(place.osm, lang);
  const heading = useFocusOnMount<HTMLHeadingElement>();

  const onShare = async () => {
    const result = await share({
      title: place.name,
      text: [place.name, place.detail, plainLngLat(place)].filter(Boolean).join('\n'),
      url: osmUrl(place),
    });
    if (result === 'copied') onToast(t.linkCopied);
  };

  const onCopy = async () => {
    await copy(plainLngLat(place));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <Sheet className="card surface" busy={loading} peek={<strong>{place.name}</strong>}>
      <header>
        <div className="card-title">
          <h2 ref={heading} tabIndex={-1}>
            {place.name}
          </h2>
          {place.detail ? (
            <p>{place.detail}</p>
          ) : (
            loading && <p className="shimmer" aria-hidden="true" />
          )}
        </div>
        <button
          type="button"
          className="icon-btn round"
          aria-label={t.close}
          onClick={(e) => {
            onClose();
            // Closed from the keyboard (no pointer): carry on in the search field.
            if (e.detail === 0) focusSearch();
          }}
        >
          <CloseIcon size={16} />
        </button>
      </header>
      {details && <PlaceDetails details={details} lng={place.lng} />}
      <button type="button" className="coords" title={t.copy} onClick={onCopy}>
        {copied ? t.copied : formatLngLat(place, 5, locale)}
        {!copied && <CopyIcon size={13} />}
        <span className="sr-only">, {t.copy}</span>
      </button>
      <div className="actions">
        <button type="button" className="action primary" onClick={onRoute}>
          <RouteIcon />
          {t.route}
        </button>
        <button type="button" className="action" onClick={onNearby}>
          <NearbyIcon />
          {t.nearby}
        </button>
        <button type="button" className="action" onClick={onShare}>
          <ShareIcon />
          {t.share}
        </button>
      </div>
    </Sheet>
  );
}
