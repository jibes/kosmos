import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { CloseIcon, Mark } from './icons';
import { restoreBackup, saveBackup } from './backup';
import { OfflineInfo } from './OfflineInfo';
import { logging, saveLog, setLogging } from './usageLog';

const SOURCE = 'https://github.com/jibes/kosmos';

export function About({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [keeping, setKeeping] = useState(logging);
  const [saveFailed, setSaveFailed] = useState(false);
  /** What the last save or restore of the backup came to, said where its buttons are. */
  const [backupNote, setBackupNote] = useState('');
  const file = useRef<HTMLInputElement>(null);

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
      // Closed and shown again at once (React's development double run): no close to act on.
      onClose={() => !dialog.current?.open && onClose()}
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
          <dt>{t.offlineMap}</dt>
          <OfflineInfo />
          <dt>{t.backup}</dt>
          <dd className="backup">
            <small>{t.backupText}</small>
            <div>
              <button
                type="button"
                className="save-log"
                onClick={() =>
                  void saveBackup().then((ok) => setBackupNote(ok ? '' : t.backupFailed))
                }
              >
                {t.backupSave}
              </button>
              <button type="button" className="save-log" onClick={() => file.current?.click()}>
                {t.backupRestore}
              </button>
            </div>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void restoreBackup(f).then(setBackupNote);
              }}
            />
            <small role="status">{backupNote}</small>
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
