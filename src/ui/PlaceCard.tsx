import { useEffect, useRef, useState } from 'react';
import { formatLngLat, osmUrl, plainLngLat } from '../core/geo';
import type { Place } from '../core/search';
import { lang, locale, t } from '../i18n';
import { focusSearch, useFocusOnMount } from './a11y';
import {
  CloseIcon,
  CopyIcon,
  KindIcon,
  NearbyIcon,
  PencilIcon,
  RouteIcon,
  ShareIcon,
  StarIcon,
} from './icons';
import {
  completeFavouritePlace,
  putBackFavourite,
  renameFavouritePlace,
  toggleFavouritePlace,
  useFavourites,
} from './useFavourites';
import { rememberPlace } from './useRecent';
import { contactStill, openInContacts, useContacts } from './useContacts';
import { favouriteOf, LABEL_MAX, titleOf, type Favourite } from '../core/favourites';
import { copy, share } from './native';
import { Departures } from './Departures';
import { PlaceDetails } from './PlaceDetails';
import { PlacePhoto } from './PlacePhoto';
import { Sheet } from './Sheet';
import { usePlaceDetails } from './usePlaceDetails';

interface Props {
  place: Place;
  loading: boolean;
  onClose: () => void;
  onToast: (msg: string, actions?: { label: string; run: () => void }[]) => void;
  onRoute: () => void;
  /** Search around this place: the map goes there and the search field opens. */
  onNearby: () => void;
}

export function PlaceCard({ place, loading, onClose, onToast, onRoute, onNearby }: Props) {
  const details = usePlaceDetails(place.osm, lang);
  const heading = useFocusOnMount<HTMLHeadingElement>();

  // A contact changed or deleted in the contacts app: its card goes, the map shows it as it is.
  const contacts = useContacts();
  const gone = !!place.contact && !contactStill(contacts, place);
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);

  const fav = favouriteOf(useFavourites(), place);
  const starred = !!fav;
  // Starred while its address was still coming: kept with it once it is here, by the name the
  // lookup found too (a dropped pin's is what is there).
  const early = useRef<Favourite | undefined>(undefined);
  useEffect(() => {
    if (loading) {
      early.current = fav;
      return;
    }
    const was = early.current;
    early.current = undefined;
    if (!fav && was) completeFavouritePlace(place, was);
    else if (fav && ((!fav.detail && place.detail) || (!fav.osm && place.osm))) {
      completeFavouritePlace(place);
    }
  }, [loading, fav, place]);
  // A renamed favourite goes by the user's name, however its card was opened.
  const name = fav ? titleOf(fav) : place.name;
  const [naming, setNaming] = useState(false);
  const cancelled = useRef(false);
  // The field closed: focus back on the heading, not lost to the page.
  const wasNaming = useRef(false);
  useEffect(() => {
    if (wasNaming.current && !naming) heading.current?.focus();
    wasNaming.current = naming;
    if (naming) cancelled.current = false;
  }, [naming, heading]);
  const rename = (label: string) => {
    renameFavouritePlace(place, label);
    setNaming(false);
  };
  const onShare = async () => {
    rememberPlace(place);
    const result = await share({
      title: place.name,
      text: [place.name, place.detail, plainLngLat(place)].filter(Boolean).join('\n'),
      url: osmUrl(place),
    });
    if (result === 'copied') onToast(t.linkCopied);
  };

  // Said in the live region like a copied link, not only swapped in the button.
  const onCopy = async () => {
    await copy(plainLngLat(place));
    onToast(t.coordsCopied);
  };

  return (
    <Sheet className="card surface" busy={loading} peek={<strong>{name}</strong>}>
      <header>
        <div className="card-title">
          {naming && fav ? (
            <input
              className="rename"
              aria-label={t.favouriteName}
              defaultValue={name}
              maxLength={LABEL_MAX}
              autoFocus
              enterKeyHint="done"
              onKeyDown={(e) => {
                if (e.key === 'Enter') rename(e.currentTarget.value);
                if (e.key === 'Escape') {
                  // Only the field, and nothing kept: the card stays open.
                  e.stopPropagation();
                  cancelled.current = true;
                  setNaming(false);
                }
              }}
              // The field going away blurs it too: an Escape keeps the name as it was.
              onBlur={(e) => naming && !cancelled.current && rename(e.currentTarget.value)}
            />
          ) : (
            <h2 ref={heading} tabIndex={-1}>
              {name}
            </h2>
          )}
          {place.detail ? (
            <p>{place.detail}</p>
          ) : (
            loading && <p className="shimmer" aria-hidden="true" />
          )}
        </div>
        <button
          type="button"
          className="icon-btn round fav"
          aria-label={t.favourite}
          title={t.favourite}
          aria-pressed={starred}
          onClick={() => {
            if (!starred) rememberPlace(place);
            toggleFavouritePlace(place);
            // Off by mistake: back in one tap, with its own name.
            if (fav)
              onToast(t.favouriteRemoved, [{ label: t.undo, run: () => putBackFavourite(fav) }]);
          }}
        >
          <StarIcon filled={starred} />
        </button>
        {starred && !naming && (
          <button
            type="button"
            className="icon-btn round"
            aria-label={t.rename}
            title={t.rename}
            onClick={() => setNaming(true)}
          >
            <PencilIcon size={16} />
          </button>
        )}
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
      <PlacePhoto photo={details?.photo} name={name} />
      {details && <PlaceDetails details={details} lng={place.lng} />}
      {place.contact && (
        <p className="contacts">
          <button
            type="button"
            onClick={async () => {
              if (!(await openInContacts(place.contact!))) onToast(t.contactNotOpened);
            }}
          >
            <KindIcon kind="person" size={16} />
            {t.openInContacts}
          </button>
        </p>
      )}
      <Departures place={place} lang={lang} />
      <button type="button" className="coords" title={t.copy} onClick={onCopy}>
        {formatLngLat(place, 5, locale)}
        <CopyIcon size={13} />
        <span className="sr-only">, {t.copy}</span>
      </button>
      <div className="actions">
        <button
          type="button"
          className="action primary"
          onClick={() => {
            rememberPlace(place);
            onRoute();
          }}
        >
          <RouteIcon />
          {t.route}
        </button>
        <button
          type="button"
          className="action"
          onClick={() => {
            rememberPlace(place);
            onNearby();
          }}
        >
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
