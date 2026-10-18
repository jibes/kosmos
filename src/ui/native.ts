import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
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

/** The app's own native helpers (`KosmosPlugin.java`). */
const Kosmos = isNative
  ? registerPlugin<{
      openSettings(): Promise<void>;
      duck(o: { on: boolean }): Promise<void>;
      log(o: { level: 'info' | 'error'; message: string }): Promise<void>;
      vibrate(o: { pattern: number[] }): Promise<void>;
      takeShared(): Promise<{ text?: string }>;
      shareFile(o: { name: string; text: string; type?: string }): Promise<void>;
      openElsewhere(o: { uri: string; title: string }): Promise<void>;
      contacts(o: { ask: boolean }): Promise<{
        allowed: boolean;
        contacts?: { name: string; address: string }[];
      }>;
      addListener(
        event: 'shared',
        listener: (e: { text: string }) => void,
      ): Promise<PluginListenerHandle>;
    }>('Kosmos')
  : null;

/** Android: a `geo:` link to the other maps apps, kOSMos left out of the chooser. */
export const openElsewhere = Kosmos
  ? (uri: string, title: string) => Kosmos.openElsewhere({ uri, title })
  : null;

/** The app's page in the system settings (Android), where location can be allowed again. */
export const openAppSettings = Kosmos
  ? () => void Kosmos.openSettings().catch(() => undefined)
  : null;

/**
 * Android: the contacts with a postal address, the permission asked for when `ask`; `null` when
 * not allowed (or on the web).
 */
export async function readContacts(ask: boolean) {
  if (!Kosmos) return null;
  const r = await Kosmos.contacts({ ask }).catch(() => null);
  return r?.allowed ? (r.contacts ?? []) : null;
}

/**
 * A text file for the user to keep: on Android to the share sheet (Save to Files, Drive, another
 * app), in the browser a download. `false` when the app could not hand it over.
 */
export async function saveFile(name: string, text: string, type = 'text/plain') {
  if (Kosmos) {
    try {
      await Kosmos.shareFile({ name, text, type });
      return true;
    } catch {
      return false;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** Android: other audio ducks while `on` (a prompt speaks), and comes back after. */
export const duckAudio = (on: boolean) => void Kosmos?.duck({ on }).catch(() => undefined);

/**
 * A buzz (milliseconds on and off in turn): the app's own vibrator on Android, where the
 * WebView has none; the browser's elsewhere, where it has one at all.
 */
export function vibrate(pattern: readonly number[]) {
  if (Kosmos) void Kosmos.vibrate({ pattern: [...pattern] }).catch(() => undefined);
  else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([...pattern]);
    } catch {
      // Not allowed here (no user gesture yet, or a desktop browser): nothing to feel.
    }
  }
}

/**
 * Android: what other apps hand over (a geo: link, a map link, a shared message), the one the
 * app was opened with first; `null` on the web, where the address bar brings it.
 */
export function watchShared(onText: (text: string) => void): (() => void) | null {
  const kosmos = Kosmos;
  if (!kosmos) return null;
  let stopped = false;
  const handle = kosmos.addListener('shared', (e) => !stopped && onText(e.text));
  void kosmos
    .takeShared()
    .then((r) => !stopped && r.text && onText(r.text))
    .catch(() => undefined);
  return () => {
    stopped = true;
    void handle.then((h) => h.remove());
  };
}

/**
 * Android: a line in the system log under the app's own tag. Release builds forward nothing else
 * from the WebView (no position ever lands in the log); the CI smoke test reads these lines.
 */
export function nativeLog(level: 'info' | 'error', message: string) {
  void Kosmos?.log({ level, message }).catch(() => undefined);
}

/** Android: the web app's errors go to the system log too, for the smoke test and bug reports. */
export function forwardErrors() {
  if (!Kosmos) return;
  window.addEventListener('error', (e) =>
    nativeLog('error', `${e.message} (${e.filename}:${e.lineno})`),
  );
  window.addEventListener('unhandledrejection', (e) =>
    nativeLog('error', `unhandled rejection: ${String(e.reason)}`),
  );
  const error = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    error(...args);
    nativeLog('error', args.map(String).join(' '));
  };
}

/** A fix from the app's own location service (`NavLocationPlugin.java`). */
export interface NativeFix {
  lng: number;
  lat: number;
  accuracy: number;
  speed?: number;
  bearing?: number;
  time: number;
}

type Grant = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';

interface NavLocationPlugin {
  /** `approximate`: running, but on approximate location only (kilometres off, rare). */
  start(o: { title: string; text: string }): Promise<{ approximate?: boolean } | undefined>;
  /** The guidance notification's text; ignored while the service is not showing it. */
  update(o: { title: string; text: string }): Promise<void>;
  stop(): Promise<void>;
  checkPermissions(): Promise<{ location: Grant; coarseLocation: Grant; notifications: Grant }>;
  addListener(event: 'location', fn: (fix: NativeFix) => void): Promise<PluginListenerHandle>;
}

/** Android: location for guidance from a foreground service, without Google Play services. */
export const NavLocation = isNative ? registerPlugin<NavLocationPlugin>('NavLocation') : null;

/** Whether location is already allowed, without asking: Android's own answer in the app. */
export async function locationAllowed(): Promise<boolean> {
  if (NavLocation) return (await NavLocation.checkPermissions()).coarseLocation === 'granted';
  if (!navigator.permissions) return false;
  return (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted';
}
