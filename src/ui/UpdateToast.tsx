import { useRegisterSW } from 'virtual:pwa-register/react';
import { t } from '../i18n';

/** An installed app can stay open for days: brought back, it looks for an update this often. */
const CHECK_MS = 60 * 60_000;

/** On every return to the app, an update check once the last is an hour old. */
function checkOnReturn(reg: ServiceWorkerRegistration | undefined) {
  if (!reg) return;
  let last = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - last < CHECK_MS) return;
    last = Date.now();
    void reg.update().catch(() => undefined);
  });
}

/**
 * Web only: the app shell updates when the user says so, never mid-gesture, and never offered
 * while guiding (a reload would end it); the update waits until then.
 */
export function UpdateToast({ hidden }: { hidden: boolean }) {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ onRegisteredSW: (_url, reg) => checkOnReturn(reg) });
  if (!needRefresh || hidden) return null;
  return (
    <div className="toast surface">
      {t.updateReady}
      <button type="button" onClick={() => updateServiceWorker(true)}>
        {t.reload}
      </button>
    </div>
  );
}
