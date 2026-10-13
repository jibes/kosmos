import type { BrowserContext } from '@playwright/test';
import GeoJSONVT from 'geojson-vt';
import vtpbf from 'vt-pbf';
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
          }),
          photonPoint(13.0, 52.4, { name: 'Brandenburg an der Havel', country: 'Deutschland' }),
        ]
      : [];
    return route.fulfill({ contentType: 'application/json', body: photon(hits) });
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
