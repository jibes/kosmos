import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

export const isNative = Capacitor.isNativePlatform();

export type ShareResult = 'shared' | 'copied' | 'cancelled';

/** Native sheet in the app, Web Share where the browser has it, clipboard otherwise. */
export async function share(data: {
  title: string;
  text: string;
  url: string;
}): Promise<ShareResult> {
  try {
    if (isNative) {
      await Share.share({ ...data, dialogTitle: data.title });
      return 'shared';
    }
    if (navigator.share) {
      await navigator.share(data);
      return 'shared';
    }
  } catch (e) {
    if (e instanceof Error && /cancel|abort/i.test(`${e.name} ${e.message}`)) return 'cancelled';
  }
  await copy(`${data.text}\n${data.url}`);
  return 'copied';
}

export async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.append(el);
    el.select();
    document.execCommand('copy');
    el.remove();
  }
}
