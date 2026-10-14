import type { BrowserContext } from '@playwright/test';
import GeoJSONVT from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { encodePolyline } from '../../src/core/route';
import { CENTER, scene } from './scene';

const indexes = Object.entries(scene()).map(
  ([name, features]) =>
    [
      name,
      new GeoJSONVT(
        { type: 'FeatureCollection', features },
        { maxZoom: 14, indexMaxZoom: 5, buffer: 64 },
      ),
    ] as const,
);

function tile(z: number, x: number, y: number): Buffer {
  const layers: Record<string, unknown> = {};
  for (const [name, index] of indexes) {
    const t = index.getTile(z, x, y);
    if (t?.features.length) layers[name] = t;
  }
  return Buffer.from(vtpbf.fromGeojsonVt(layers, { version: 2 }));
}

export const SEARCH_HIT = {
  name: 'Brandenburger Tor',
  lng: CENTER.lng - 1000 / 67800,
  lat: CENTER.lat - 330 / 111200,
};

const photon = (features: object[]) => JSON.stringify({ type: 'FeatureCollection', features });
const photonPoint = (lng: number, lat: number, properties: object) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties,
});

type Pt = [number, number];

/** An L-shaped trip through `corner`, with the maneuvers Valhalla would describe. */
function fakeTrip(a: Pt, corner: Pt, b: Pt, speed: number) {
  const km = (p: Pt, q: Pt) => Math.hypot((q[0] - p[0]) * 67.8, (q[1] - p[1]) * 111.2);
  const k1 = km(a, corner);
  const k2 = km(corner, b);
  const coords: Pt[] = [a, corner, b];
  return {
    legs: [
      {
        shape: encodePolyline(coords),
        maneuvers: [
          {
            type: 1,
            instruction: 'Head south on Friedrichstraße.',
            verbal_pre_transition_instruction: 'Head south on Friedrichstraße.',
            street_names: ['Friedrichstraße'],
            length: k1,
            time: (k1 / speed) * 3600,
            begin_shape_index: 0,
          },
          {
            type: 10,
            instruction: 'Turn right onto Unter den Linden.',
            verbal_transition_alert_instruction: 'Turn right onto Unter den Linden.',
            verbal_pre_transition_instruction: 'Turn right onto Unter den Linden.',
            verbal_post_transition_instruction: 'Continue for 600 meters.',
            street_names: ['Unter den Linden'],
            // Two lanes straight on, the right one turns right.
            lanes: [{ directions: 2 }, { directions: 2 }, { directions: 64, active: 64 }],
            length: k2,
            time: (k2 / speed) * 3600,
            begin_shape_index: 1,
          },
          {
            type: 4,
            instruction: 'You have arrived at your destination.',
            verbal_pre_transition_instruction: 'You have arrived at your destination.',
            length: 0,
            time: 0,
            begin_shape_index: 2,
          },
        ],
      },
    ],
    summary: { length: k1 + k2, time: ((k1 + k2) / speed) * 3600 },
  };
}

/** A Transitous plan: walk to a stop, ride the U6 with a late start, walk on; or walk all the way. */
function fakePlan(a: Pt, b: Pt, depart: number) {
  const iso = (min: number) => new Date(depart + min * 60_000).toISOString();
  const s1: Pt = [a[0], (a[1] + b[1]) / 2 + 0.002];
  const s2: Pt = [b[0], s1[1]];
  const place = (name: string, p: Pt, extra = {}) => ({ name, lon: p[0], lat: p[1], ...extra });
  const leg = (
    mode: string,
    from: object,
    to: object,
    m0: number,
    m1: number,
    pts: Pt[],
    extra = {},
  ) => ({
    mode,
    from,
    to,
    startTime: iso(m0),
    endTime: iso(m1),
    scheduledStartTime: iso(m0),
    scheduledEndTime: iso(m1),
    realTime: false,
    duration: (m1 - m0) * 60,
    legGeometry: { points: encodePolyline(pts), precision: 6, length: pts.length },
    ...extra,
  });
  return {
    itineraries: [3, 13].map((t0) => ({
      startTime: iso(t0),
      endTime: iso(t0 + 22),
      duration: 22 * 60,
      transfers: 0,
      legs: [
        leg('WALK', place('START', a), place('Stadtmitte', s1), t0, t0 + 5, [a, s1], {
          distance: 380,
          steps: [
            { relativeDirection: 'DEPART', distance: 200, streetName: 'Friedrichstraße' },
            { relativeDirection: 'LEFT', distance: 300, streetName: 'Dorotheenstraße' },
          ],
        }),
        leg(
          'SUBWAY',
          place('Stadtmitte', s1, { track: '2', stopId: 'de:stadtmitte' }),
          place('Unter den Linden', s2),
          t0 + 5,
          t0 + 17,
          [s1, s2],
          {
            displayName: 'U6',
            tripId: `u6-${t0}`,
            headsign: 'Alt-Tegel',
            routeColor: '8C6DAB',
            intermediateStops: [1, 2].map((k) =>
              place(
                k === 1 ? 'Französische Straße' : 'Friedrichstraße',
                [s1[0] + ((s2[0] - s1[0]) * k) / 3, s1[1]],
                {
                  arrival: iso(t0 + 5 + 4 * k),
                },
              ),
            ),
            // The first train runs two minutes late.
            ...(t0 === 3 ? { scheduledStartTime: iso(t0 + 3) } : {}),
          },
        ),
        leg('WALK', place('Unter den Linden', s2), place('END', b), t0 + 17, t0 + 22, [s2, b], {
          distance: 300,
        }),
      ],
    })),
    direct: [
      {
        startTime: iso(0),
        endTime: iso(48),
        duration: 48 * 60,
        transfers: 0,
        legs: [leg('WALK', place('START', a), place('END', b), 0, 48, [a, b], { distance: 3600 })],
      },
    ],
  };
}

/** Departure time of the last plan served, to answer departure checks consistently. */
let planDepart = 0;

/** Every Nominatim lookup the app made. */
export const lookupRequests: URLSearchParams[] = [];

/** Every Transitous departure check the app made. */
export const stopTimesRequests: URLSearchParams[] = [];

/** Every Transitous plan request the app made. */
export const transitRequests: URLSearchParams[] = [];

/** Every routing request the app made, for assertions. */
export const routeRequests: { costing: string; from: Pt; to: Pt }[] = [];

/** Serves tiles, glyphs and search from the synthetic scene; nothing leaves the machine. */
export async function offlineWorld(context: BrowserContext) {
  await context.route('https://tiles.openfreemap.org/planet', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        tilejson: '3.0.0',
        tiles: ['https://tiles.openfreemap.org/fixture/{z}/{x}/{y}.pbf'],
        minzoom: 0,
        maxzoom: 14,
      }),
    }),
  );
  await context.route(/tiles\.openfreemap\.org\/fixture\/(\d+)\/(\d+)\/(\d+)\.pbf/, (route) => {
    const [, z, x, y] = /\/(\d+)\/(\d+)\/(\d+)\.pbf/.exec(route.request().url())!.map(Number);
    return route.fulfill({ contentType: 'application/x-protobuf', body: tile(z, x, y) });
  });
  // Every glyph the Inter font faces do not cover comes back empty.
  await context.route(/tiles\.openfreemap\.org\/fonts\//, (route) =>
    route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) }),
  );
  await context.route(/photon\.komoot\.io\/api\//, (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    const hits = /brandenburg/i.test(q)
      ? [
          photonPoint(SEARCH_HIT.lng, SEARCH_HIT.lat, {
            name: SEARCH_HIT.name,
            street: 'Pariser Platz',
            district: 'Mitte',
            city: 'Berlin',
            country: 'Deutschland',
            osm_type: 'W',
            osm_id: 518071791,
          }),
          photonPoint(13.0, 52.4, { name: 'Brandenburg an der Havel', country: 'Deutschland' }),
        ]
      : [];
    return route.fulfill({ contentType: 'application/json', body: photon(hits) });
  });
  await context.route(/valhalla1\.openstreetmap\.de\/route/, (route) => {
    const body = JSON.parse(new URL(route.request().url()).searchParams.get('json') ?? '{}');
    const [s, e] = body.locations.map((l: { lat: number; lon: number }) => [l.lon, l.lat] as Pt);
    routeRequests.push({ costing: body.costing, from: s, to: e });
    const speed = { auto: 30, bicycle: 15, pedestrian: 5 }[body.costing as string] ?? 30;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trip: fakeTrip(s, [s[0], e[1]], e, speed),
        alternates: [{ trip: fakeTrip(s, [e[0], s[1]], e, speed * 0.8) }],
      }),
    });
  });
  await context.route(/api\.transitous\.org\/api\/v5\/plan/, (route) => {
    const q = new URL(route.request().url()).searchParams;
    transitRequests.push(q);
    const pt = (v: string | null) => (v ?? '0,0').split(',').map(Number).reverse() as Pt;
    const time = q.get('time');
    planDepart = time ? Date.parse(time) : Date.now();
    return route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(fakePlan(pt(q.get('fromPlace')), pt(q.get('toPlace')), planDepart)),
    });
  });
  // The first U6 (planned at minute 8) runs three minutes late and moved to platform 3.
  await context.route(/api\.transitous\.org\/api\/v5\/stoptimes/, (route) => {
    stopTimesRequests.push(new URL(route.request().url()).searchParams);
    const at = (min: number) => new Date(planDepart + min * 60_000).toISOString();
    return route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        stopTimes: [
          {
            tripId: 'u6-3',
            realTime: true,
            place: { name: 'Stadtmitte', departure: at(11), scheduledDeparture: at(8), track: '3' },
          },
        ],
      }),
    });
  });
  await context.route(/nominatim\.openstreetmap\.org\/lookup/, (route) => {
    const q = new URL(route.request().url()).searchParams;
    lookupRequests.push(q);
    const known = q.get('osm_ids') === 'W518071791';
    return route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(
        known
          ? [
              {
                osm_type: 'way',
                osm_id: 518071791,
                extratags: {
                  opening_hours: 'Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off',
                  phone: '+49 30 1234567',
                  website: 'https://www.example.org/tor',
                },
              },
            ]
          : [],
      ),
    });
  });
  await context.route(/photon\.komoot\.io\/reverse/, (route) => {
    const p = new URL(route.request().url()).searchParams;
    return route.fulfill({
      contentType: 'application/json',
      body: photon([
        photonPoint(Number(p.get('lon')), Number(p.get('lat')), {
          street: 'Unter den Linden',
          housenumber: '5',
          city: 'Berlin',
          country: 'Deutschland',
        }),
      ]),
    });
  });
}
