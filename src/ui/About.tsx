import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { CloseIcon, Mark } from './icons';
import { logging, saveLog, setLogging } from './usageLog';

const SOURCE = 'https://github.com/jibes/kosmos';

export function About({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [keeping, setKeeping] = useState(logging);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    // Closed by any way, focus goes back to what opened it, not to the page.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    d?.showModal();
    return () => {
      d?.close();
      opener?.focus();
    };
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
          <dt>{t.usageLog}</dt>
          <dd className="usage-log">
            <label>
              <input
                type="checkbox"
                checked={keeping}
                onChange={(e) => {
                  setLogging(e.target.checked);
                  setKeeping(e.target.checked);
                }}
              />
              {t.usageLogKeep}
            </label>
            <small>{t.usageLogText}</small>
            {keeping && (
              <button
                type="button"
                className="save-log"
                onClick={() => void saveLog().then((ok) => setSaveFailed(!ok))}
              >
                {t.usageLogSave}
              </button>
            )}
            {saveFailed && <small role="alert">{t.usageLogFailed}</small>}
          </dd>
        </dl>
        <p className="fine">
          {t.licence}{' '}
          <a href={SOURCE} target="_blank" rel="noreferrer">
            {t.source}
          </a>{' '}
          ·{' '}
          <a href={`${SOURCE}/blob/main/THIRD_PARTY_NOTICES.md`} target="_blank" rel="noreferrer">
            {t.sources}
          </a>
          <br />
          {t.version} {__BUILD__.version} · {__BUILD__.sha}
        </p>
      </div>
    </dialog>
  );
}
