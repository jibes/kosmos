import { describe, expect, it } from 'vitest';
import { allDay, hoursState, parseHours, weekRows } from '../src/core/hours';

// 2026-10-12 is a Monday.
const at = (day: number, hh: number, mm = 0) => new Date(2026, 9, 12 + day, hh, mm);
const state = (spec: string, when: Date) => hoursState(parseHours(spec)!, when);

describe('opening hours', () => {
  const shop = 'Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off';

  it('is open during hours, with the closing time', () => {
    expect(state(shop, at(0, 10))).toEqual({ open: true, change: at(0, 18) });
    expect(state(shop, at(5, 13, 30))).toEqual({ open: true, change: at(5, 14) });
  });

  it('is closed outside, with the next opening, across the weekend', () => {
    expect(state(shop, at(0, 7))).toEqual({ open: false, change: at(0, 9) });
    expect(state(shop, at(5, 15))).toEqual({ open: false, change: at(7, 9) });
    expect(state(shop, at(6, 12))).toEqual({ open: false, change: at(7, 9) });
  });

  it('runs past midnight', () => {
    const bar = 'Th-Sa 20:00-02:00';
    expect(state(bar, at(4, 23))).toEqual({ open: true, change: at(5, 2) });
    expect(state(bar, at(5, 1))).toEqual({ open: true, change: at(5, 2) });
    // Saturday night into Sunday.
    expect(state(bar, at(6, 1, 30))).toEqual({ open: true, change: at(6, 2) });
    expect(state(bar, at(6, 3))).toEqual({ open: false, change: at(10, 20) });
  });

  it('handles lunch breaks, lists and later rules overriding earlier ones', () => {
    const cafe = 'Mo-Sa 08:00-12:00,13:00-18:00; We off';
    expect(state(cafe, at(0, 12, 30))).toEqual({ open: false, change: at(0, 13) });
    expect(state(cafe, at(2, 10))).toEqual({ open: false, change: at(3, 8) });
    expect(state('Mo,We,Fr 10:00-12:00', at(1, 11))).toEqual({ open: false, change: at(2, 10) });
  });

  it('knows always open and joins spans that touch', () => {
    expect(state('24/7', at(3, 3))).toEqual({ open: true, always: true });
    expect(state('Mo-Su 00:00-24:00', at(3, 3))).toEqual({ open: true, always: true });
    expect(state('Mo-Fr 00:00-24:00', at(3, 3))).toEqual({ open: true, change: at(5, 0) });
  });

  it('skips holidays it cannot know and refuses what it cannot read', () => {
    expect(state('Mo-Fr 09:00-17:00; PH off', at(0, 10)).open).toBe(true);
    expect(state('Mo-Fr,PH 09:00-17:00', at(0, 10)).open).toBe(true);
    expect(parseHours('Jan-Mar Mo-Fr 09:00-17:00')).toBeNull();
    expect(parseHours('sunrise-sunset')).toBeNull();
    expect(parseHours('Mo-Fr 09:00+')).toBeNull();
    expect(parseHours('"by appointment"')).toBeNull();
    expect(parseHours('')).toBeNull();
    expect(state('off', at(0, 10))).toEqual({ open: false, never: true });
  });
});

describe('weekRows', () => {
  it('groups days with the same hours, closed days included', () => {
    const rows = weekRows(parseHours('Mo-Fr 09:00-18:00; Sa 10:00-14:00')!);
    expect(rows).toEqual([
      { from: 0, to: 4, spans: [[540, 1080]] },
      { from: 5, to: 5, spans: [[600, 840]] },
      { from: 6, to: 6, spans: [] },
    ]);
  });

  it('reads 24/7 as one row of whole days', () => {
    const rows = weekRows(parseHours('24/7')!);
    expect(rows).toEqual([{ from: 0, to: 6, spans: [[0, 1440]] }]);
    expect(allDay(rows[0].spans)).toBe(true);
    expect(allDay([[0, 1080]])).toBe(false);
    expect(allDay([])).toBe(false);
  });

  it('keeps a night past midnight on the day it starts', () => {
    const rows = weekRows(parseHours('Fr-Sa 22:00-03:00')!);
    expect(rows.find((r) => r.from === 4)).toEqual({ from: 4, to: 5, spans: [[1320, 1620]] });
  });
});
