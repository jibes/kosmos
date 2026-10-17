import { describe, expect, it } from 'vitest';
import {
  bannerText,
  classifyError,
  decodePolyline,
  encodePolyline,
  formatClock,
  formatDistance,
  formatDuration,
  parseValhalla,
  roadModeOf,
  routeUrl,
  speedIn,
  spokenDistance,
  needsTollFree,
  withTollFree,
  turnOf,
  unitsFor,
  type Route,
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
      // Cycleways and quiet streets over busy roads.
      costing_options: { bicycle: { use_roads: 0.25 } },
      directions_options: { units: 'kilometers', language: 'de' },
      alternates: 2,
      turn_lanes: true,
    });
  });

  it('keeps a walk to footways and sidewalks, off roads without them', () => {
    const body = (mode: 'foot' | 'bike' | 'car') =>
      JSON.parse(
        new URL(routeUrl({ lng: 0, lat: 0 }, { lng: 1, lat: 1 }, mode, 'de')).searchParams.get(
          'json',
        )!,
      );
    const foot = body('foot').costing_options.pedestrian;
    expect(foot.walkway_factor).toBeLessThan(1);
    expect(foot.sidewalk_factor).toBeLessThan(1);
    expect(foot.walkway_factor).toBeLessThan(foot.sidewalk_factor);
    expect(body('bike').costing_options.bicycle.use_roads).toBeLessThan(0.5);
    expect(body('car').costing_options).toBeUndefined();
  });

  it('drives around toll roads when asked, by car only', () => {
    const body = (mode: 'car' | 'bike', avoid: boolean) =>
      JSON.parse(
        new URL(
          routeUrl({ lng: 0, lat: 0 }, { lng: 1, lat: 1 }, mode, 'de', 2, 'metric', avoid),
        ).searchParams.get('json')!,
      );
    // A preference alone still lets a toll motorway win: they are excluded.
    expect(body('car', true).costing_options).toEqual({
      auto: { use_tolls: 0, exclude_tolls: true },
    });
    expect(body('car', false).costing_options).toBeUndefined();
    expect(body('bike', true).costing_options.auto).toBeUndefined();
  });

  it('falls back to English instructions', () => {
    const url = new URL(routeUrl({ lng: 0, lat: 0 }, { lng: 1, lat: 1 }, 'foot', 'xx', 0));
    const body = JSON.parse(url.searchParams.get('json')!);
    expect(body.directions_options.language).toBe('en');
    expect(body.costing).toBe('pedestrian');
  });

  it('asks for miles where they are used', () => {
    const url = new URL(routeUrl({ lng: 0, lat: 0 }, { lng: 1, lat: 1 }, 'car', 'en', 2, 'us'));
    expect(JSON.parse(url.searchParams.get('json')!).directions_options.units).toBe('miles');
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

describe('roadModeOf', () => {
  it('guides a road mode as it is, public transport walks and no trip as by car', () => {
    expect(roadModeOf({ mode: 'bike' })).toBe('bike');
    expect(roadModeOf({ mode: 'transit' })).toBe('car');
    expect(roadModeOf(null)).toBe('car');
  });
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

  it('asks for a toll-free way only when every way found has tolls, and adds it', () => {
    const r = (toll: boolean, duration: number) => ({ toll, duration }) as unknown as Route;
    expect(needsTollFree([r(true, 1), r(true, 2)])).toBe(true);
    expect(needsTollFree([r(true, 1), r(false, 2)])).toBe(false);
    expect(needsTollFree([])).toBe(false);
    const both = withTollFree([r(true, 1)], [r(false, 3)]);
    expect(both.map((x) => x.duration)).toEqual([1, 3]);
    // A router that ignored the exclusion gives nothing new.
    expect(withTollFree([r(true, 1)], [r(true, 3)])).toHaveLength(1);
    expect(withTollFree([r(true, 1)], [])).toHaveLength(1);
  });

  it('says when a route uses a toll road', () => {
    const t = trip(
      [
        [13.4, 52.5],
        [13.4, 52.51],
      ],
      1,
      60,
    );
    expect(parseValhalla({ trip: t })[0].toll).toBeUndefined();
    const tolled = { ...t, summary: { ...t.summary, has_toll: true } };
    expect(parseValhalla({ trip: tolled })[0].toll).toBe(true);
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

  it('writes times as the locale reads them: no leading zero on a 12-hour clock', () => {
    const morning = new Date(2024, 0, 1, 6, 5);
    // ICU spaces "AM" with a narrow no-break space or a plain one, depending on its version.
    expect(formatClock(morning, 'en-US').replace(/\s/u, ' ')).toBe('6:05 AM');
    expect(formatClock(morning, 'en-GB')).toBe('06:05');
    expect(formatClock(morning, 'de-DE')).toBe('06:05');
  });

  it('leads the banner with the street for a plain turn, the sentence otherwise', () => {
    const right = { type: 10, instruction: 'Turn right onto Unter den Linden.' };
    expect(bannerText({ ...right, street: 'Unter den Linden' })).toBe('Unter den Linden');
    // No street to show: the sentence, without its full stop.
    expect(bannerText(right)).toBe('Turn right onto Unter den Linden');
    // A roundabout's exit or a ramp's sign is more than the arrow says.
    const exit = { type: 26, instruction: 'Enter the roundabout and take the 2nd exit.' };
    expect(bannerText({ ...exit, street: 'Ring' })).toBe(
      'Enter the roundabout and take the 2nd exit',
    );
    expect(bannerText({ type: 1, instruction: 'Drive south.', street: 'Friedrichstraße' })).toBe(
      'Drive south',
    );
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

describe('units', () => {
  it('reads lengths in the unit the router answered in', () => {
    const trip = (units: string) => ({
      trip: {
        units,
        legs: [
          {
            shape: encodePolyline([
              [13.4, 52.5],
              [13.5, 52.5],
            ]),
            maneuvers: [
              { type: 1, instruction: 'Go.', length: 4.3, time: 300, begin_shape_index: 0 },
            ],
          },
        ],
        summary: { length: 4.3, time: 300 },
      },
    });
    const [mi] = parseValhalla(trip('miles'));
    expect(mi.distance).toBeCloseTo(4.3 * 1609.344, 3);
    expect(mi.maneuvers[0].distance).toBeCloseTo(4.3 * 1609.344, 3);
    const [km] = parseValhalla(trip('kilometers'));
    expect(km.distance).toBeCloseTo(4300, 3);
  });

  it('follows the region of the locale', () => {
    expect(unitsFor('en-US')).toBe('us');
    expect(unitsFor('en-GB')).toBe('uk');
    expect(unitsFor('en')).toBe('metric');
    expect(unitsFor('de-DE')).toBe('metric');
  });

  it('writes miles with feet or yards', () => {
    expect(formatDistance(30, 'en', 'us')).toBe('100 ft');
    expect(formatDistance(120, 'en', 'us')).toBe('400 ft');
    expect(formatDistance(150, 'en', 'us')).toBe('500 ft');
    expect(formatDistance(120, 'en', 'uk')).toBe('130 yd');
    expect(formatDistance(1609, 'en', 'us')).toBe('1.0 mi');
    expect(formatDistance(30_000, 'en', 'uk')).toBe('19 mi');
  });

  it('says miles and feet ahead of a turn', () => {
    expect(spokenDistance(150, 'us')).toEqual({ value: 500, unit: 'ft' });
    expect(spokenDistance(480, 'us')).toEqual({ value: 0.3, unit: 'mi' });
    expect(spokenDistance(100, 'uk')).toEqual({ value: 100, unit: 'yd' });
  });

  it('gives speed in mph where miles are used', () => {
    expect(speedIn(13.4112, 'us')).toBe(30);
    expect(speedIn(10, 'metric')).toBe(36);
  });
});

describe('rerouting', () => {
  it('asks for one route leaving in the direction of travel', () => {
    const url = routeUrl(
      { lng: 13.4, lat: 52.5, heading: 370 },
      { lng: 13.41, lat: 52.51 },
      'car',
      'en',
      0,
    );
    const body = JSON.parse(decodeURIComponent(url.split('json=')[1]));
    expect(body.locations[0]).toMatchObject({ heading: 10, heading_tolerance: 45 });
    expect(body.locations[1].heading).toBeUndefined();
    expect(body.alternates).toBe(0);
  });

  it('leaves the direction open when there is none', () => {
    const url = routeUrl(
      { lng: 13.4, lat: 52.5, heading: null },
      { lng: 13.41, lat: 52.51 },
      'car',
      'en',
    );
    const body = JSON.parse(decodeURIComponent(url.split('json=')[1]));
    expect(body.locations[0].heading).toBeUndefined();
  });
});
