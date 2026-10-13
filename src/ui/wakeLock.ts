import { KeepAwake } from '@capacitor-community/keep-awake';
import { isNative } from './native';

/** Keeps the screen on while navigating; re-acquired when the page becomes visible again. */
export function keepAwake(): () => void {
  if (isNative) {
    void KeepAwake.keepAwake().catch(() => undefined);
    return () => void KeepAwake.allowSleep().catch(() => undefined);
  }
  let lock: WakeLockSentinel | null = null;
  let active = true;
  const acquire = async () => {
    if (!active || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
    try {
      lock = await navigator.wakeLock.request('screen');
    } catch {
      // Battery saver or an unsupported browser: guidance still works, the screen may sleep.
    }
  };
  const onVisible = () => void acquire();
  document.addEventListener('visibilitychange', onVisible);
  void acquire();
  return () => {
    active = false;
    document.removeEventListener('visibilitychange', onVisible);
    void lock?.release().catch(() => undefined);
  };
}
