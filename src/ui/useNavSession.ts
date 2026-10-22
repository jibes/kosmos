import { useEffect } from 'react';
import { t } from '../i18n';
import { openAppSettings } from './native';
import type { useLocation } from './useLocation';
import { usePip } from './usePip';
import { keepAwake } from './wakeLock';

/**
 * What a phone does while guiding: location from the service (which asks for precise
 * location, and says so with a Settings button when it is refused), the screen kept on, and
 * the small window on the way home.
 */
export function useNavSession(
  navigating: boolean,
  background: ReturnType<typeof useLocation>['background'],
  showToast: (text: string, actions?: { label: string; run: () => void }[]) => void,
) {
  useEffect(() => {
    if (!navigating) return;
    background(true, () =>
      showToast(
        t.needPrecise,
        openAppSettings ? [{ label: t.settings, run: openAppSettings }] : undefined,
      ),
    );
    const release = keepAwake();
    return () => {
      release();
      background(false);
    };
  }, [navigating, background, showToast]);
  usePip(navigating);
}
