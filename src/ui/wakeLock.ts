/** Keeps the screen on while navigating; re-acquired when the page becomes visible again. */
export function keepAwake(): () => void {
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
