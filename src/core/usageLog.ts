/**
 * A usage and debug log kept on the device, only when the user turns it on (About), for
 * deciding what the app can do without and for finding faults: what was used, offered and
 * ignored, and when the app went to the background. Never a position, never what was typed.
 * JSON Lines, one event a line, the oldest dropped once the log passes its size.
 */
export type LogValue = string | number | boolean | null;
export type LogData = Record<string, LogValue>;

/** About 400 KB: weeks of driving, and well inside what the browser's storage allows. */
export const LOG_MAX_CHARS = 400_000;

/** One event as a line: its time (ms), its name and its data. */
export const logLine = (time: number, event: string, data: LogData = {}) =>
  JSON.stringify({ t: time, e: event, ...data });

/** The log with `lines` added, the oldest lines dropped until it fits `max` characters. */
export function appendLog(log: string, lines: string[], max = LOG_MAX_CHARS): string {
  let out = lines.length ? (log ? `${log}\n${lines.join('\n')}` : lines.join('\n')) : log;
  if (out.length <= max) return out;
  // Whole lines only: cut at the first line break past the excess.
  const cut = out.indexOf('\n', out.length - max);
  out = cut === -1 ? '' : out.slice(cut + 1);
  return out;
}

/** What a reader needs before the events: the build and the device's kind, no identity. */
export function logHeader(meta: LogData, time: number): string {
  return logLine(time, 'log.export', meta);
}

/** The file's name: the app and the day it was saved. */
export const logFileName = (time: number) =>
  `kosmos-log-${new Date(time).toISOString().slice(0, 10)}.txt`;
