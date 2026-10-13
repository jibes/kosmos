import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import { CloseIcon, Mark } from './icons';

const SOURCE = 'https://github.com/jibes/kosmos';

export function About({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    return () => d?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="about surface"
      aria-labelledby="about-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="about-body">
        <button
          type="button"
          className="icon-btn round close"
          aria-label={t.close}
          onClick={onClose}
        >
          <CloseIcon size={16} />
        </button>
        <Mark size={56} />
        <h2 id="about-title">
          k<span>OSM</span>os
        </h2>
        <p className="tagline">{t.tagline}</p>
        <dl>
          <dt>{t.credits}</dt>
          <dd>{t.creditsText}</dd>
          <dt>{t.privacy}</dt>
          <dd>{t.privacyText}</dd>
        </dl>
        <p className="fine">
          {t.licence}{' '}
          <a href={SOURCE} target="_blank" rel="noreferrer">
            {t.source}
          </a>
          <br />
          {t.version} {__BUILD__.version} · {__BUILD__.sha}
        </p>
      </div>
    </dialog>
  );
}
