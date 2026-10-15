import { useRegisterSW } from 'virtual:pwa-register/react';
import { t } from '../i18n';

/**
 * Web only: the app shell updates when the user says so, never mid-gesture, and never offered
 * while guiding (a reload would end it); the update waits until then.
 */
export function UpdateToast({ hidden }: { hidden: boolean }) {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh || hidden) return null;
  return (
    <div className="toast surface" role="status">
      {t.updateReady}
      <button type="button" onClick={() => updateServiceWorker(true)}>
        {t.reload}
      </button>
    </div>
  );
}
