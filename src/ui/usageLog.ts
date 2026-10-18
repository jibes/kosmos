import { appendLog, logFileName, logHeader, logLine, type LogData } from '../core/usageLog';
import { lang } from '../i18n';
import { isNative, saveFile } from './native';
import { LOG_KEY, LOGGING_KEY, store, stored } from './prefs';

let on = stored(LOGGING_KEY) === '1';
let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

/** Written in batches: guidance logs every few seconds, storage need not be touched as often. */
const FLUSH_MS = 5_000;

function flush() {
  clearTimeout(timer);
  timer = undefined;
  if (!pending.length) return;
  store(LOG_KEY, appendLog(stored(LOG_KEY) ?? '', pending));
  pending = [];
}

/** An event, when the user keeps the log; nothing at all otherwise. */
export function logEvent(event: string, data?: LogData) {
  if (!on) return;
  pending.push(logLine(Date.now(), event, data));
  timer ??= setTimeout(flush, FLUSH_MS);
}

export const logging = () => on;

/** On: from now. Off: what was kept is deleted. */
export function setLogging(next: boolean) {
  on = next;
  store(LOGGING_KEY, next ? '1' : '0');
  if (next) {
    logEvent('log.on', { v: __BUILD__.version });
  } else {
    pending = [];
    clearTimeout(timer);
    timer = undefined;
    try {
      localStorage.removeItem(LOG_KEY);
    } catch {
      // Nothing kept to delete.
    }
  }
}

/** The log as a file: to the share sheet in the app, a download in the browser. */
export async function saveLog(): Promise<boolean> {
  flush();
  const now = Date.now();
  const header = logHeader(
    {
      v: __BUILD__.version,
      sha: __BUILD__.sha,
      native: isNative,
      lang,
      ua: navigator.userAgent,
    },
    now,
  );
  const text = `${header}\n${stored(LOG_KEY) ?? ''}\n`;
  const name = logFileName(now);
  return saveFile(name, text);
}

// The app going out of sight and back: when guidance goes quiet in the background, this says
// how long the page was away. Pending lines are kept before the page may be frozen or closed.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    logEvent(document.hidden ? 'app.hidden' : 'app.visible');
    if (document.hidden) flush();
  });
  addEventListener('pagehide', flush);
  addEventListener('error', (e) => logEvent('error', { msg: String(e.message).slice(0, 200) }));
  logEvent('app.start', { v: __BUILD__.version, native: isNative });
}
