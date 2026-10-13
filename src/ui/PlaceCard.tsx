import { useState } from 'react';
import { formatLngLat, osmUrl, plainLngLat } from '../core/geo';
import type { Place } from '../core/search';
import { t } from '../i18n';
import { CloseIcon, RouteIcon, ShareIcon } from './icons';
import { copy, share } from './native';

interface Props {
  place: Place;
  loading: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
  onRoute: () => void;
}

export function PlaceCard({ place, loading, onClose, onToast, onRoute }: Props) {
  const [copied, setCopied] = useState(false);

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
    <section className="card surface" aria-live="polite" aria-busy={loading}>
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
      <button type="button" className="coords" onClick={onCopy} aria-label={t.copy}>
        {copied ? t.copied : formatLngLat(place)}
      </button>
      <div className="actions">
        <button type="button" className="action primary" onClick={onRoute}>
          <RouteIcon />
          {t.route}
        </button>
        <button type="button" className="action" onClick={onShare}>
          <ShareIcon />
          {t.share}
        </button>
      </div>
    </section>
  );
}
