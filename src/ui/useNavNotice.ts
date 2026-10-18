import { useEffect, useRef } from 'react';
import { NavLocation } from './native';

/** Android drops a burst of notification updates; one a second keeps the distance current. */
const EVERY_MS = 1_000;

/**
 * Android: the guidance notification says what the banner says (the next turn and how far, or
 * the stop), so the lock screen shows it without unlocking. Only what changed is sent, at most
 * once a second, the latest text last.
 */
export function useNavNotice(title: string, text: string) {
  const sent = useRef({ at: 0, key: '' });
  useEffect(() => {
    const plugin = NavLocation;
    if (!plugin || !title) return;
    const key = `${title}\n${text}`;
    if (key === sent.current.key) return;
    const send = () => {
      sent.current = { at: Date.now(), key };
      void plugin.update({ title, text }).catch(() => undefined);
    };
    const wait = sent.current.at + EVERY_MS - Date.now();
    if (wait <= 0) return send();
    const id = setTimeout(send, wait);
    return () => clearTimeout(id);
  }, [title, text]);
}
