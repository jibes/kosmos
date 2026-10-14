import { describe, expect, it } from 'vitest';
import {
  classifyError,
  decodePolyline,
  encodePolyline,
  formatDistance,
  formatDuration,
  parseValhalla,
  routeUrl,
  spokenDistance,
  turnOf,
} from '../src/core/route';

describe('polyline', () => {
  it("decodes Google's reference example at precision 5", () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it('round-trips at precision 6, including negatives', () => {
    const line: [number, number][] = [
      [13.405, 52.52],
      [-0.1276, 51.5072],
      [151.2093, -33.8688],
    ];
    expect(decodePolyline(encodePolyline(line))).toEqual(line);
    expect(decodePolyline('')).toEqual([]);
  });
});

describe('routeUrl', () => {
  it('asks Valhalla for the right costing, language and alternates', () => {
    const url = new URL(routeUrl({ lng: 13.4, lat: 52.5 }, { lng: 13.5, lat: 52.6 }, 'bike', 'de'));
    expect(url.origin + url.pathname).toBe('https://valhalla1.openstreetmap.de/route');
    const body = JSON.parse(url.searchParams.get('json')!);
    expect(body).toEqual({
      locations: [
        { lat: 52.5, lon: 13.4 },
        { lat: 52.6, lon: 13.5 },
      ],
      costing: 'bicycle',
      directions_options: { units: 'kilometers', language: 'de' },
      alternates: 2,
      turn_lanes: true,
    });
  });

  it('falls back to English instructions', () => {
    const url = new URL(routeUrl({ lng: 0, lat: 0 }, { lng: 1, lat: 1 }, 'foot', 'xx', 0));
    const body = JSON.parse(url.searchParams.get('json')!);
    expect(body.directions_options.language).toBe('en');
    expect(body.costing).toBe('pedestrian');
  });
});

const trip = (coords: [number, number][], km: number, s: number) => ({
  legs: [
    {
      shape: encodePolyline(coords),
      maneuvers: [
        {
          type: 1,
          instruction: 'Drive north.',
          verbal_pre_transition_instruction: 'Drive north.',
          street_names: ['A'],
          length: km / 2,
          time: s / 2,
          begin_shape_index: 0,
        },
        {
          type: 10,
          instruction: 'Turn right onto B.',
          verbal_transition_alert_instruction: 'Turn right onto B.',
          verbal_pre_transition_instruction: 'Turn right onto B.',
          verbal_post_transition_instruction: 'Continue for 500 meters.',
          street_names: ['B'],
          lanes: [{ directions: 2 }, { directions: 66, active: 64 }],
          length: km / 2,
          time: s / 2,
          begin_shape_index: 1,
        },
        { type: 4, instruction: 'You have arrived.', length: 0, time: 0, begin_shape_index: 2 },
      ],
    },
  ],
  summary: { length: km, time: s },
});

describe('parseValhalla', () => {
  it('reads the trip and alternates in metres and seconds', () => {
    const routes = parseValhalla({
      trip: trip(
        [
          [13.4, 52.5],
          [13.4, 52.51],
          [13.41, 52.51],
        ],
        1.8,
        240,
      ),
      alternates: [
        {
          trip: trip(
            [
              [13.4, 52.5],
              [13.41, 52.5],
              [13.41, 52.51],
            ],
            2.1,
            300,
          ),
        },
      ],
    });
    expect(routes).toHaveLength(2);
    const [r] = routes;
    expect(r.distance).toBeCloseTo(1800);
    expect(r.duration).toBe(240);
    expect(r.coords).toHaveLength(3);
    expect(r.bbox).toEqual([13.4, 52.5, 13.41, 52.51]);
    expect(r.maneuvers[1]).toMatchObject({
      type: 10,
      street: 'B',
      begin: 1,
      alert: 'Turn right onto B.',
      post: 'Continue for 500 meters.',
    });
    expect(r.maneuvers[1].distance).toBeCloseTo(900);
    expect(r.maneuvers[1].lanes).toEqual([{ directions: 2 }, { directions: 66, active: 64 }]);
    expect(r.maneuvers[0].lanes).toBeUndefined();
  });

  it('returns [] for errors and garbage', () => {
    expect(parseValhalla(null)).toEqual([]);
    expect(parseValhalla({ error: 'No path could be found' })).toEqual([]);
    expect(parseValhalla({ trip: { legs: [{ shape: '' }] } })).toEqual([]);
  });
});

describe('formatting', () => {
  it('rounds distances like a person would say them', () => {
    expect(formatDistance(12, 'en')).toBe('10 m');
    expect(formatDistance(437, 'en')).toBe('440 m');
    expect(formatDistance(4234, 'en')).toBe('4.2 km');
    expect(formatDistance(4234, 'de')).toBe('4,2 km');
    expect(formatDistance(37_400, 'en')).toBe('37 km');
  });

  it('formats durations', () => {
    expect(formatDuration(10)).toBe('1 min');
    expect(formatDuration(42 * 60)).toBe('42 min');
    expect(formatDuration(125 * 60)).toBe('2 h 05');
  });

  it('maps errors and turns', () => {
    expect(classifyError(429)).toBe('busy');
    expect(classifyError(400)).toBe('none');
    expect(classifyError(500)).toBe('failed');
    expect(turnOf(10)).toBe('right');
    expect(turnOf(16)).toBe('slight-left');
    expect(turnOf(26)).toBe('roundabout');
    expect(turnOf(4)).toBe('arrive');
    expect(turnOf(8)).toBe('straight');
  });
});

describe('spokenDistance', () => {
  it('rounds as people say it before a turn', () => {
    expect(spokenDistance(83)).toEqual({ value: 80, unit: 'm' });
    expect(spokenDistance(4)).toEqual({ value: 10, unit: 'm' });
    expect(spokenDistance(487)).toEqual({ value: 500, unit: 'm' });
    expect(spokenDistance(612)).toEqual({ value: 600, unit: 'm' });
    expect(spokenDistance(1240)).toEqual({ value: 1.2, unit: 'km' });
    expect(spokenDistance(2000)).toEqual({ value: 2, unit: 'km' });
  });
});
