import { describe, expect, it } from 'vitest';
import {
  isStopOsm,
  isStopPoi,
  parseDepartures,
  stopTimesUrl,
  DEPARTURES_SHOWN,
} from '../src/core/departures';

const at = (iso: string) => Date.parse(iso);
const st = (dep: string, planned: string, extra: object = {}) => ({
  place: { departure: dep, scheduledDeparture: planned },
  mode: 'SUBWAY',
  displayName: 'U6',
  headsign: 'Alt-Tegel',
  routeColor: '8C6DAB',
  ...extra,
});

describe('departures', () => {
  it('asks around the stop, one request', () => {
    const url = new URL(stopTimesUrl({ lng: 13.388, lat: 52.52 }, 'de'));
    expect(url.pathname).toBe('/api/v5/stoptimes');
    expect(url.searchParams.get('center')).toBe('52.520000,13.388000');
    expect(url.searchParams.get('radius')).toBe('150');
    expect(url.searchParams.get('language')).toBe('de');
  });

  it('reads times, delays, lines and platforms, soonest first', () => {
    const now = at('2026-10-16T10:00:00Z');
    const list = parseDepartures(
      {
        stopTimes: [
          st('2026-10-16T10:12:00Z', '2026-10-16T10:10:00Z', {
            place: {
              departure: '2026-10-16T10:12:00Z',
              scheduledDeparture: '2026-10-16T10:10:00Z',
              track: '2',
              scheduledTrack: '1',
            },
          }),
          st('2026-10-16T10:05:00Z', '2026-10-16T10:05:00Z', {
            displayName: 'M1',
            mode: 'TRAM',
            headsign: 'Mitte',
            routeColor: undefined,
            tripCancelled: true,
          }),
        ],
      },
      now,
    );
    expect(list.map((d) => d.line)).toEqual(['M1', 'U6']);
    expect(list[0]).toMatchObject({ cancelled: true, delay: 0, mode: 'TRAM' });
    expect(list[0].color).toBeUndefined();
    expect(list[1]).toMatchObject({
      delay: 2,
      track: '2',
      moved: true,
      color: '#8c6dab',
      textColor: '#ffffff',
    });
  });

  it('drops what has gone and what comes twice, keeps a few', () => {
    const now = at('2026-10-16T10:00:00Z');
    const same = st('2026-10-16T10:03:00Z', '2026-10-16T10:03:00Z');
    const many = Array.from({ length: 10 }, (_, i) =>
      st(`2026-10-16T10:${String(10 + i)}:00Z`, `2026-10-16T10:${String(10 + i)}:00Z`),
    );
    const list = parseDepartures(
      { stopTimes: [st('2026-10-16T09:50:00Z', '2026-10-16T09:50:00Z'), same, same, ...many] },
      now,
    );
    expect(list).toHaveLength(DEPARTURES_SHOWN);
    expect(list[0].time).toBe(at('2026-10-16T10:03:00Z'));
    expect(list[1].time).toBe(at('2026-10-16T10:10:00Z'));
    expect(parseDepartures({}, now)).toEqual([]);
    expect(parseDepartures(null, now)).toEqual([]);
  });

  it('knows a stop from its map label or its search hit', () => {
    expect(isStopPoi({ class: 'railway', subclass: 'station' })).toBe(true);
    expect(isStopPoi({ class: 'bus', subclass: 'bus_stop' })).toBe(true);
    expect(isStopPoi({ class: 'cafe', subclass: 'cafe' })).toBe(false);
    expect(isStopOsm('railway', 'station')).toBe(true);
    expect(isStopOsm('highway', 'bus_stop')).toBe(true);
    expect(isStopOsm('highway', 'residential')).toBe(false);
  });
});
