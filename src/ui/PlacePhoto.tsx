import { useState } from 'react';
import type { PhotoRef } from '../core/photo';
import { fill, t } from '../i18n';
import { usePhoto } from './usePhoto';

/**
 * The place's photo from Wikimedia Commons, with who made it and its licence, as the licence
 * asks; both lead to the file's page. Nothing at all while there is none or it fails to load.
 */
export function PlacePhoto({ photo: ref, name }: { photo?: PhotoRef; name: string }) {
  const photo = usePhoto(ref);
  const [shown, setShown] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (!photo || failed === photo.src) return null;
  const credit = [photo.artist, photo.licence, t.commons].filter(Boolean).join(' · ');
  return (
    <figure className="place-photo" data-shown={shown === photo.src || undefined}>
      <a href={photo.page} target="_blank" rel="noreferrer" tabIndex={-1} aria-hidden="true">
        <img
          src={photo.src}
          width={photo.width}
          height={photo.height}
          alt=""
          decoding="async"
          onLoad={() => setShown(photo.src)}
          onError={() => setFailed(photo.src)}
        />
      </a>
      <figcaption>
        <a href={photo.page} target="_blank" rel="noreferrer">
          <span className="sr-only">{fill(t.photoOf, { name })}: </span>
          {credit}
        </a>
      </figcaption>
    </figure>
  );
}
