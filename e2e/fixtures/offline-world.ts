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
    let t = index.getTile(z, x, y);
    // Like OpenMapTiles: below zoom 14 only the most important places.
    if (t && name === 'poi' && z < 14) {
      t = { ...t, features: t.features.filter((f) => Number(f.tags?.rank) <= 1) };
    }
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
function fakeTrip(a: Pt, corner: Pt, b: Pt, speed: number, signed = false) {
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
            // A signpost at the turn, as cycle routes have.
            ...(signed
              ? {
                  sign: {
                    exit_toward_elements: [
                      { text: 'Pariser Platz' },
                      { text: 'B2', is_route_number: true },
                    ],
                  },
                }
              : {}),
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

/** Every Nominatim search the app made (only as a fallback when Photon fails). */
export const nominatimSearches: URLSearchParams[] = [];

/** Every Nominatim lookup the app made. */
export const lookupRequests: URLSearchParams[] = [];

/** Every Transitous departure check the app made. */
export const tripRequests: URLSearchParams[] = [];
/** What the live trip says; a test may cancel the U6 (and must set it back). */
export const liveTrip = { cancelled: false };

/** A test may make the planner fail (and must set it back). */
export const planFails = { on: false };

/** Every Transitous plan request the app made. */
export const transitRequests: URLSearchParams[] = [];

/** Every routing request the app made, for assertions. */
/** Every Photon search the app made, by its text. */
export const photonSearches: string[] = [];

/** The planet build the TileJSON names, as OpenFreeMap renews it every week or so. */
export const tileset = { build: '20261001_001001_pt' };

/** Every departures request, by its query. */
export const stopTimesRequests: URLSearchParams[] = [];

/** The speed-limit requests made, by costing. */
export const limitRequests: string[] = [];
export const routeRequests: {
  costing: string;
  from: Pt;
  to: Pt;
  via: Pt[];
  noTolls?: boolean;
}[] = [];

/** Serves tiles, glyphs and search from the synthetic scene; nothing leaves the machine. */
export async function offlineWorld(context: BrowserContext) {
  // The first-visit hint is a note over the map; only the test that asks for it (?hint) sees it.
  await context.addInitScript(() => {
    if (!location.search.includes('hint')) localStorage.setItem('kosmos.hinted.v1', '1');
  });
  await context.route('https://tiles.openfreemap.org/planet', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        tilejson: '3.0.0',
        tiles: [`https://tiles.openfreemap.org/planet/${tileset.build}/{z}/{x}/{y}.pbf`],
        minzoom: 0,
        maxzoom: 14,
      }),
    }),
  );
  await context.route(
    /tiles\.openfreemap\.org\/planet\/[^/]+\/(\d+)\/(\d+)\/(\d+)\.pbf/,
    (route) => {
      const [, z, x, y] = /\/(\d+)\/(\d+)\/(\d+)\.pbf/.exec(route.request().url())!.map(Number);
      return route.fulfill({ contentType: 'application/x-protobuf', body: tile(z, x, y) });
    },
  );
  // Every glyph the Inter font faces do not cover comes back empty.
  await context.route(/tiles\.openfreemap\.org\/fonts\//, (route) =>
    route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) }),
  );
  await context.route(/photon\.komoot\.io\/api\//, (route) => {
    const params = new URL(route.request().url()).searchParams;
    const q = params.get('q') ?? '';
    const hits = /^flughafen$/i.test(q)
      ? // Asked for airports alone, the airport; else only a street of that name.
        params.get('osm_tag') === 'aeroway:aerodrome'
        ? [
            photonPoint(CENTER.lng + 0.2, CENTER.lat + 0.1, {
              name: 'Flughafen Zürich',
              city: 'Kloten',
              osm_key: 'aeroway',
              osm_value: 'aerodrome',
            }),
          ]
        : [
            photonPoint(CENTER.lng, CENTER.lat + 0.01, {
              name: 'Flughafenstraße',
              city: 'Berlin',
              osm_key: 'highway',
              type: 'street',
            }),
          ]
      : /^platz$/i.test(q)
        ? // A short word many places share: more than a screen of them.
          Array.from({ length: 12 }, (_, i) =>
            photonPoint(CENTER.lng + i * 0.002, CENTER.lat, {
              name: `Platz ${i + 1}`,
              city: 'Berlin',
            }),
          )
        : /brandenburg/i.test(q)
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
              photonPoint(13.0, 52.4, {
                name: 'Brandenburg an der Havel',
                country: 'Deutschland',
                // A town: an extent to fit, [minLon, maxLat, maxLon, minLat].
                extent: [12.45, 52.47, 12.65, 52.36],
              }),
            ]
          : /einstein/i.test(q)
            ? // Another branch of the same name, 2 km away; the tapped one is not in the index.
              [
                photonPoint(CENTER.lng + 0.03, CENTER.lat, {
                  name: 'Café Einstein',
                  street: 'Kurfürstenstraße',
                  city: 'Berlin',
                  osm_type: 'N',
                  osm_id: 777,
                }),
              ]
            : /media/i.test(q)
              ? // The chain's branches Photon knows: one far away, one in view.
                [
                  photonPoint(CENTER.lng, CENTER.lat - 0.05, {
                    name: 'MediaMarkt',
                    city: 'Berlin',
                  }),
                  // One of the branches in view: its row would repeat the chain's.
                  photonPoint(CENTER.lng - 250 / 67800, CENTER.lat - 500 / 111200, {
                    name: 'MediaMarkt',
                    city: 'Mitte',
                  }),
                ]
              : [];
    photonSearches.push(q);
    return route.fulfill({ contentType: 'application/json', body: photon(hits) });
  });
  // Speed limits along a followed route: 30 km/h all the way.
  await context.route(/valhalla1\.openstreetmap\.de\/trace_attributes/, (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    limitRequests.push(body.costing);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ edges: [{ length: 5, speed_limit: 30 }] }),
    });
  });
  await context.route(/valhalla1\.openstreetmap\.de\/route/, (route) => {
    const body = JSON.parse(new URL(route.request().url()).searchParams.get('json') ?? '{}');
    const points = body.locations.map((l: { lat: number; lon: number }) => [l.lon, l.lat] as Pt);
    const [s, e] = [points[0], points.at(-1)];
    const via: Pt[] = points.slice(1, -1);
    const noTolls = !!body.costing_options?.auto?.exclude_tolls;
    routeRequests.push({ costing: body.costing, from: s, to: e, via, noTolls });
    const speed = { auto: 30, bicycle: 15, pedestrian: 5 }[body.costing as string] ?? 30;
    // By way of stops: one leg to each, as the router arrives at each and sets off again.
    if (via.length) {
      const legs = points.slice(1).map((q: Pt, i: number) => {
        const p = points[i];
        return fakeTrip(p, [p[0], q[1]], q, speed);
      });
      const trip = {
        legs: legs.flatMap((l: ReturnType<typeof fakeTrip>) => l.legs),
        summary: {
          length: legs.reduce(
            (n: number, l: ReturnType<typeof fakeTrip>) => n + l.summary.length,
            0,
          ),
          time: legs.reduce((n: number, l: ReturnType<typeof fakeTrip>) => n + l.summary.time, 0),
        },
      };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ trip }) });
    }
    const main = fakeTrip(s, [s[0], e[1]], e, speed, body.costing === 'bicycle');
    const other = fakeTrip(s, [e[0], s[1]], e, speed * 0.8);
    // By car both ways have toll roads; asked to leave them out, a slower way without.
    if (body.costing === 'auto' && !noTolls) {
      for (const t of [main, other]) Object.assign(t.summary, { has_toll: true });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        noTolls
          ? { trip: fakeTrip(s, [s[0], (s[1] + e[1]) / 2], e, speed * 0.6) }
          : { trip: main, alternates: [{ trip: other }] },
      ),
    });
  });
  await context.route(/api\.transitous\.org\/api\/v5\/stoptimes/, (route) => {
    stopTimesRequests.push(new URL(route.request().url()).searchParams);
    const iso = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
    const at = (planned: number, live: number, track: string, planTrack = track) => ({
      departure: iso(live),
      scheduledDeparture: iso(planned),
      track,
      scheduledTrack: planTrack,
    });
    return route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        stopTimes: [
          {
            place: at(4, 6, '2', '1'),
            mode: 'SUBURBAN',
            displayName: 'S1',
            headsign: 'Oranienburg',
            routeColor: 'DE4DA4',
          },
          { place: at(2, 2, '3'), mode: 'SUBWAY', displayName: 'U6', headsign: 'Alt-Tegel' },
        ],
      }),
    });
  });
  await context.route(/api\.transitous\.org\/api\/v5\/plan/, (route) => {
    const q = new URL(route.request().url()).searchParams;
    transitRequests.push(q);
    if (planFails.on) return route.fulfill({ status: 503, body: '' });
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
  await context.route(/api\.transitous\.org\/api\/v5\/trip/, (route) => {
    tripRequests.push(new URL(route.request().url()).searchParams);
    const at = (min: number) => new Date(planDepart + min * 60_000).toISOString();
    return route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        startTime: at(0),
        endTime: at(40),
        legs: [
          {
            mode: 'SUBWAY',
            tripId: 'u6-3',
            realTime: true,
            cancelled: liveTrip.cancelled,
            startTime: at(0),
            endTime: at(40),
            from: { name: 'Alt-Mariendorf', stopId: 'de:alt-mariendorf', departure: at(0) },
            intermediateStops: [
              {
                name: 'Stadtmitte',
                stopId: 'de:stadtmitte',
                arrival: at(11),
                departure: at(11),
                scheduledDeparture: at(8),
                track: '3',
                scheduledTrack: '2',
              },
              { name: 'Französische Straße', arrival: at(15) },
              { name: 'Friedrichstraße', arrival: at(19) },
              { name: 'Unter den Linden', arrival: at(23) },
            ],
            to: { name: 'Alt-Tegel', stopId: 'de:alt-tegel', arrival: at(40) },
          },
        ],
      }),
    });
  });
  await context.route(/nominatim\.openstreetmap\.org\/search/, (route) => {
    const q = new URL(route.request().url()).searchParams;
    nominatimSearches.push(q);
    const hit = /brandenburg/i.test(q.get('q') ?? '');
    return route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(
        hit
          ? [
              {
                name: SEARCH_HIT.name,
                display_name: `${SEARCH_HIT.name}, Pariser Platz, Mitte, Berlin, Deutschland`,
                lat: String(SEARCH_HIT.lat),
                lon: String(SEARCH_HIT.lng),
                osm_type: 'way',
                osm_id: 518071791,
              },
            ]
          : [],
      ),
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
                lat: '52.5163',
                lon: '13.3777',
                name: 'Brandenburger Tor',
                display_name: 'Brandenburger Tor, Pariser Platz, Mitte, Berlin, Deutschland',
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
