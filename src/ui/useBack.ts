import { App as NativeApp } from '@capacitor/app';
import { useEffect, useRef } from 'react';
import { isNative } from './native';

/**
 * Android's back button and Escape step back one layer at a time (the handler says whether it
 * closed something). With nothing left to close, back sends the app to the background instead
 * of quitting it, so navigation and the map survive a stray press.
 */
export function useBack(handler: () => boolean) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) latest.current();
    };
    window.addEventListener('keydown', onKey);
    const listener = isNative
      ? NativeApp.addListener('backButton', () => {
          if (!latest.current()) void NativeApp.minimizeApp();
        })
      : null;
    return () => {
      window.removeEventListener('keydown', onKey);
      void listener?.then((l) => l.remove());
    };
  }, []);
}
