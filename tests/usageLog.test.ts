import { describe, expect, it } from 'vitest';
import { appendLog, logFileName, logHeader, logLine } from '../src/core/usageLog';

describe('usage log', () => {
  it('writes one event a line, its time and name first', () => {
    expect(logLine(5, 'nav.start', { mode: 'car' })).toBe('{"t":5,"e":"nav.start","mode":"car"}');
    expect(JSON.parse(logHeader({ v: '1.0.0' }, 9))).toEqual({ t: 9, e: 'log.export', v: '1.0.0' });
  });

  it('appends lines and drops the oldest whole lines past its size', () => {
    let log = '';
    log = appendLog(log, ['a1', 'b2']);
    expect(log).toBe('a1\nb2');
    log = appendLog(log, ['c3'], 6);
    // "a1\nb2\nc3" is 8: the oldest line goes.
    expect(log).toBe('b2\nc3');
    expect(appendLog('x', [], 6)).toBe('x');
    // A single line longer than the log may be: nothing kept rather than half a line.
    expect(appendLog('', ['0123456789'], 4)).toBe('');
  });

  it('names the file by the day it was saved', () => {
    expect(logFileName(Date.parse('2026-10-18T12:00:00Z'))).toBe('kosmos-log-2026-10-18.txt');
  });
});
