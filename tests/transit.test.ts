import { describe, expect, it } from 'vitest';
import { encodePolyline } from '../src/core/route';
import {
  clockValue,
  departureAt,
  parseMotis,
  stopTimesUrl,
  textOn,
  transitUrl,
  vehicleOf,
  withDeparture,
} from '../src/core/transit';

const at = (hh: number, mm: number, day = 13) => new Date(2026, 9, day, hh, mm).getTime();

describe('transitUrl', () => {
  it('asks Transitous v5 for a plan, now unless a time is set', () => {
    const url = new URL(transitUrl({ lng: 13.4, lat: 52.5 }, { lng: 13.5, lat: 52.6 }, 'de'));
    expect(url.origin + url.pathname).toBe('https://api.transitous.org/api/v5/plan');
    expect(url.searchParams.get('fromPlace')).toBe('52.500000,13.400000');
    expect(url.searchParams.get('toPlace')).toBe('52.600000,13.500000');
    expect(url.searchParams.get('language')).toBe('de');
    expect(url.searchParams.has('time')).toBe(false);
    const later = new URL(transitUrl({ lng: 0, lat: 0 }, { lng: 1, lat: 1 }, 'en', 0));
    expect(later.searchParams.get('time')).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('departureAt', () => {
  it('means today, or tomorrow once the time has passed', () => {
    const now = at(22, 30);
    expect(departureAt('23:15', now)).toBe(at(23, 15));
    expect(departureAt('22:25', now)).toBe(at(22, 25));
    expect(departureAt('06:00', now)).toBe(at(6, 0, 14));
    expect(departureAt('nonsense', now)).toBeNull();
    expect(clockValue(at(7, 5))).toBe('07:05');
  });
});

describe('textOn', () => {
  it('picks the readable ink for a line colour', () => {
    expect(textOn('#ffd800')).toBe('#000000');
    expect(textOn('#004e9e')).toBe('#ffffff');
  });
});

describe('parseMotis', () => {
  const a: [number, number] = [13.4, 52.5];
  const b: [number, number] = [13.41, 52.5];
  const c: [number, number] = [13.45, 52.52];
  const d: [number, number] = [13.46, 52.52];
  const json = {
    itineraries: [
      {
        startTime: '2026-10-13T12:00:00Z',
        endTime: '2026-10-13T12:25:00Z',
        duration: 1500,
        transfers: 0,
        legs: [
          {
            mode: 'WALK',
            from: { name: 'START', lat: a[1], lon: a[0] },
            to: { name: 'Stadtmitte', lat: b[1], lon: b[0] },
            startTime: '2026-10-13T12:00:00Z',
            endTime: '2026-10-13T12:06:00Z',
            scheduledStartTime: '2026-10-13T12:00:00Z',
            distance: 420,
            legGeometry: { points: encodePolyline([a, b]), precision: 6 },
            steps: [
              { relativeDirection: 'DEPART', distance: 120, streetName: 'Leipziger Straße' },
              { relativeDirection: 'LEFT', distance: 300, streetName: 'Friedrichstraße' },
            ],
          },
          {
            mode: 'SUBWAY',
            from: { name: 'Stadtmitte', lat: b[1], lon: b[0], track: '2', stopId: 'de:stadtmitte' },
            tripId: 'u2-1207',
            to: { name: 'Alexanderplatz', lat: c[1], lon: c[0] },
            startTime: '2026-10-13T12:08:00Z',
            endTime: '2026-10-13T12:20:00Z',
            scheduledStartTime: '2026-10-13T12:06:00Z',
            displayName: 'U2',
            headsign: 'Pankow',
            routeColor: 'DA421E',
            intermediateStops: [{}, {}, {}],
            legGeometry: { points: encodePolyline([b, c]), precision: 6 },
          },
          {
            mode: 'WALK',
            from: { name: 'Alexanderplatz', lat: c[1], lon: c[0] },
            to: { name: 'END', lat: d[1], lon: d[0] },
            startTime: '2026-10-13T12:20:00Z',
            endTime: '2026-10-13T12:25:00Z',
            legGeometry: { points: '', precision: 6 },
          },
        ],
      },
    ],
    direct: [
      {
        startTime: '2026-10-13T12:00:00Z',
        endTime: '2026-10-13T12:50:00Z',
        duration: 3000,
        transfers: 0,
        legs: [
          {
            mode: 'WALK',
            from: { name: 'START', lat: a[1], lon: a[0] },
            to: { name: 'END', lat: d[1], lon: d[0] },
            startTime: '2026-10-13T12:00:00Z',
            endTime: '2026-10-13T12:50:00Z',
            distance: 4100,
            legGeometry: { points: encodePolyline([a, d]), precision: 6 },
          },
        ],
      },
    ],
  };

  it('reads connections, then walking the whole way', () => {
    const routes = parseMotis(json);
    expect(routes).toHaveLength(2);
    const [r, walk] = routes;
    expect(r.duration).toBe(1500);
    expect(r.maneuvers).toEqual([]);
    expect(r.coords).toEqual([a, b, c, d]);
    expect(r.bbox).toEqual([13.4, 52.5, 13.46, 52.52]);
    expect(r.transit).toMatchObject({
      start: Date.parse('2026-10-13T12:00:00Z'),
      end: Date.parse('2026-10-13T12:25:00Z'),
      transfers: 0,
    });
    expect(walk.transit?.legs).toHaveLength(1);
    expect(walk.distance).toBe(4100);
  });

  it('describes each leg as a rider needs it', () => {
    const [walkIn, ride, walkOut] = parseMotis(json)[0].transit!.legs;
    expect(walkIn).toMatchObject({ ride: false, distance: 420, delay: 0 });
    expect(walkIn.line).toBeUndefined();
    expect(ride).toMatchObject({
      ride: true,
      mode: 'SUBWAY',
      line: 'U2',
      headsign: 'Pankow',
      color: '#da421e',
      textColor: '#ffffff',
      stops: 3,
      delay: 2,
      from: { name: 'Stadtmitte', track: '2' },
      to: { name: 'Alexanderplatz' },
    });
    // No geometry: a straight line between the stops, measured.
    expect(walkOut.coords).toEqual([c, d]);
    expect(walkOut.distance).toBeGreaterThan(600);
  });

  it('survives an empty or broken answer', () => {
    expect(parseMotis(null)).toEqual([]);
    expect(parseMotis({ itineraries: [{ legs: [{ mode: 'BUS' }] }] })).toEqual([]);
    expect(parseMotis({ error: 'oops' })).toEqual([]);
  });

  it('reads the turns of a walk and the ids of a ride', () => {
    const [walk, ride] = parseMotis(json)[0].transit!.legs;
    expect(walk.steps).toEqual([
      { turn: 'depart', street: 'Leipziger Straße', at: 0 },
      { turn: 'left', street: 'Friedrichstraße', at: 120 },
    ]);
    expect(ride.steps).toEqual([]);
    expect(ride.trip).toBe('u2-1207');
    expect(ride.from.id).toBe('de:stadtmitte');
  });
});

describe('departure check', () => {
  const transit = () => parseMotis(JSON.parse(JSON.stringify(sample)))[0].transit!;
  const sample = {
    itineraries: [
      {
        startTime: '2026-10-13T12:00:00Z',
        endTime: '2026-10-13T12:30:00Z',
        legs: [
          {
            mode: 'BUS',
            from: { name: 'A', lat: 52.5, lon: 13.4, stopId: 'a' },
            to: { name: 'B', lat: 52.5, lon: 13.5 },
            startTime: '2026-10-13T12:00:00Z',
            endTime: '2026-10-13T12:20:00Z',
            scheduledStartTime: '2026-10-13T12:00:00Z',
            tripId: 't1',
            intermediateStops: [
              { name: 'M', lat: 52.5, lon: 13.45, arrival: '2026-10-13T12:10:00Z' },
            ],
          },
          {
            mode: 'WALK',
            from: { name: 'B', lat: 52.5, lon: 13.5 },
            to: { name: 'END', lat: 52.51, lon: 13.5 },
            startTime: '2026-10-13T12:20:00Z',
            endTime: '2026-10-13T12:30:00Z',
          },
        ],
      },
    ],
  };

  it('asks the boarding stop for departures around the scheduled time', () => {
    const url = new URL(stopTimesUrl(transit().legs[0], 'de')!);
    expect(url.pathname).toBe('/api/v5/stoptimes');
    expect(url.searchParams.get('stopId')).toBe('a');
    expect(url.searchParams.get('time')).toBe('2026-10-13T11:55:00.000Z');
    expect(stopTimesUrl(transit().legs[1], 'de')).toBeNull();
  });

  it('moves the ride and the walk after it to the live departure', () => {
    const live = withDeparture(transit(), 0, {
      stopTimes: [
        { tripId: 'other', place: { departure: '2026-10-13T12:01:00Z' } },
        {
          tripId: 't1',
          place: {
            departure: '2026-10-13T12:04:00Z',
            scheduledDeparture: '2026-10-13T12:00:00Z',
            track: '7',
          },
        },
      ],
    })!;
    const [ride, walk] = live.legs;
    expect(ride).toMatchObject({ delay: 4, from: { track: '7' }, cancelled: false });
    expect(ride.start).toBe(Date.parse('2026-10-13T12:04:00Z'));
    expect(ride.end).toBe(Date.parse('2026-10-13T12:24:00Z'));
    expect(ride.via[0].arrival).toBe(Date.parse('2026-10-13T12:14:00Z'));
    expect(walk.end).toBe(Date.parse('2026-10-13T12:34:00Z'));
    expect(live.end).toBe(walk.end);
  });

  it('reports a cancellation and ignores an answer without the trip', () => {
    const cancelled = withDeparture(transit(), 0, {
      stopTimes: [
        { tripId: 't1', tripCancelled: true, place: { departure: '2026-10-13T12:00:00Z' } },
      ],
    });
    expect(cancelled?.legs[0].cancelled).toBe(true);
    expect(withDeparture(transit(), 0, { stopTimes: [] })).toBeNull();
    expect(withDeparture(transit(), 0, null)).toBeNull();
  });
});

describe('vehicleOf', () => {
  it('names the vehicle behind each mode', () => {
    expect(vehicleOf('TRAM')).toBe('tram');
    expect(vehicleOf('SUBURBAN')).toBe('train');
    expect(vehicleOf('METRO')).toBe('subway');
    expect(vehicleOf('FERRY')).toBe('ferry');
    expect(vehicleOf('COACH')).toBe('bus');
    expect(vehicleOf('AERIAL_LIFT')).toBe('cable');
    expect(vehicleOf('WALK')).toBeNull();
    expect(vehicleOf('OTHER')).toBeNull();
  });
});
