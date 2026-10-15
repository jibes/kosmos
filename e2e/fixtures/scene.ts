/**
 * A synthetic world in the OpenMapTiles schema: crude continents for the globe view, and one
 * small invented city quarter with every feature class the style draws. Tests and screenshots
 * run against it, so they never touch the real tile or search services.
 */
import type { Feature, Geometry, Position } from 'geojson';

export const CENTER = { lng: 13.405, lat: 52.52 };

type Props = Record<string, string | number>;
export type Layers = Record<string, Feature[]>;

/** Local metres east/north of CENTER to lng/lat. */
const m = (x: number, y: number): Position => [CENTER.lng + x / 67800, CENTER.lat + y / 111200];

const f = (geometry: Geometry, properties: Props = {}): Feature => ({
  type: 'Feature',
  geometry,
  properties,
});
const line = (pts: Position[], p?: Props) => f({ type: 'LineString', coordinates: pts }, p);
const poly = (rings: Position[][], p?: Props) => f({ type: 'Polygon', coordinates: rings }, p);
const point = (pt: Position, p?: Props) => f({ type: 'Point', coordinates: pt }, p);
const rect = (x0: number, y0: number, x1: number, y1: number) => [
  m(x0, y0),
  m(x1, y0),
  m(x1, y1),
  m(x0, y1),
  m(x0, y0),
];
const circle = (cx: number, cy: number, r: number, n = 32) => {
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return m(cx + r * Math.cos(a), cy + r * Math.sin(a) * 0.8);
  });
  return [...pts, pts[0]];
};

// Deterministic jitter so screenshots are stable.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function world(): Layers {
  const europeAsiaAfrica: Position[] = [
    [-10, 36],
    [-9.5, 43],
    [-1.5, 46],
    [-4.5, 48.5],
    [2, 51],
    [8, 54],
    [10, 57.5],
    [5, 62],
    [15, 69],
    [30, 71],
    [60, 70],
    [100, 77],
    [140, 72],
    [180, 68],
    [160, 60],
    [142, 50],
    [122, 40],
    [121, 30],
    [108, 20],
    [100, 8],
    [80, 8],
    [72, 20],
    [57, 25],
    [52, 13],
    [43, 12],
    [51, 11],
    [40, -15],
    [35, -25],
    [20, -35],
    [12, -18],
    [9, 4],
    [-8, 4],
    [-17, 15],
    [-17, 21],
    [-6, 36],
    [-10, 36],
  ];
  const americas: Position[] = [
    [-168, 66],
    [-140, 70],
    [-95, 72],
    [-80, 63],
    [-60, 55],
    [-66, 45],
    [-75, 35],
    [-81, 25],
    [-97, 26],
    [-97, 18],
    [-83, 9],
    [-78, 8],
    [-80, -5],
    [-71, -18],
    [-75, -50],
    [-68, -55],
    [-58, -38],
    [-41, -22],
    [-35, -7],
    [-50, 0],
    [-62, 10],
    [-76, 10],
    [-87, 21],
    [-90, 30],
    [-110, 23],
    [-117, 33],
    [-124, 40],
    [-124, 48],
    [-135, 57],
    [-150, 60],
    [-168, 66],
  ];
  const australia: Position[] = [
    [114, -22],
    [122, -18],
    [131, -12],
    [137, -12],
    [142, -11],
    [146, -19],
    [153, -26],
    [150, -37],
    [141, -38],
    [131, -31],
    [115, -34],
    [114, -22],
  ];
  // Holes run clockwise against the counter-clockwise outer ring.
  const ocean = poly(
    [
      [
        [-180, -85],
        [180, -85],
        [180, 85],
        [-180, 85],
        [-180, -85],
      ],
      [...europeAsiaAfrica].reverse(),
      [...americas].reverse(),
      [...australia].reverse(),
    ],
    { class: 'ocean' },
  );
  const country = (name: string, at: Position, rank: number) =>
    point(at, { class: 'country', name, 'name:en': name, rank });
  const city = (name: string, at: Position, rank: number, cls = 'city') =>
    point(at, { class: cls, name, rank });
  return {
    water: [ocean],
    water_name: [
      point([-35, 30], { class: 'ocean', name: 'Atlantic Ocean' }),
      point([80, -20], { class: 'ocean', name: 'Indian Ocean' }),
    ],
    boundary: [
      line(
        [
          [6, 51],
          [7, 49.5],
          [8, 48.5],
          [10, 47.5],
          [13, 47.7],
          [13.8, 48.7],
          [12, 50.3],
          [15, 51],
          [14.3, 53.3],
        ],
        {
          admin_level: 2,
          maritime: 0,
          disputed: 0,
        },
      ),
      line(
        [
          [2.5, 51],
          [4, 49.9],
          [6, 49.4],
          [8, 48.9],
          [7.5, 47.6],
          [6, 46.2],
          [7, 44],
          [3, 42.5],
          [-1.7, 43.3],
        ],
        {
          admin_level: 2,
          maritime: 0,
          disputed: 0,
        },
      ),
    ],
    place: [
      point([15, 52], { class: 'continent', name: 'Europe' }),
      point([20, 8], { class: 'continent', name: 'Africa' }),
      country('Germany', [10.4, 51.2], 1),
      country('France', [2.5, 46.8], 1),
      country('Poland', [19.3, 52.1], 2),
      country('Italy', [12.5, 43], 1),
      country('Spain', [-3.7, 40.2], 1),
      // Names with diacritics, precomposed and decomposed, as tiles may carry either.
      country('Türkiye', [35, 39], 1),
      country('Österreich', [14.5, 47.5], 2),
      country('Česko', [15.5, 49.8], 2),
      country('Tu\u0308rkiye', [44, 33], 2),
      city('Berlin', [13.388, 52.517], 1),
      city('Paris', [2.35, 48.86], 1),
      city('Hamburg', [10, 53.55], 2),
      city('München', [11.58, 48.14], 2),
      city('Leipzig', [12.37, 51.34], 4),
      city('Potsdam', [13.06, 52.39], 6, 'town'),
    ],
    transportation: [
      line(
        [
          [13.4, 52.52],
          [12.2, 53.0],
          [10, 53.55],
        ],
        { class: 'motorway' },
      ),
      line(
        [
          [13.4, 52.52],
          [12.37, 51.34],
          [11.58, 48.14],
        ],
        { class: 'motorway' },
      ),
      line(
        [
          [2.35, 48.86],
          [6, 49.3],
          [8.7, 50.1],
          [12.37, 51.34],
        ],
        { class: 'motorway' },
      ),
    ],
  };
}

function city(): Layers {
  const layers: Layers = {
    water: [],
    waterway: [],
    landcover: [],
    landuse: [],
    park: [],
    transportation: [],
    transportation_name: [],
    building: [],
    housenumber: [],
    poi: [],
    place: [],
    water_name: [],
    mountain_peak: [],
  };
  const riverY = (x: number) => 380 + 140 * Math.sin(x / 700) + x * 0.08;
  const xs = Array.from({ length: 21 }, (_, i) => -2500 + i * 250);
  layers.water.push(
    poly(
      [
        [
          ...xs.map((x) => m(x, riverY(x) + 55)),
          ...[...xs].reverse().map((x) => m(x, riverY(x) - 55)),
          m(xs[0], riverY(xs[0]) + 55),
        ],
      ],
      {
        class: 'river',
      },
    ),
    poly([circle(-1250, 1250, 260)], { class: 'lake' }),
  );
  layers.waterway.push(
    line(
      xs.map((x) => m(x, riverY(x))),
      { class: 'river', name: 'Spree' },
    ),
    line([m(-2500, -1050), m(-800, -980), m(400, -1100), m(2500, -900)], {
      class: 'canal',
      name: 'Landwehrkanal',
    }),
  );
  layers.water_name.push(point(m(-1250, 1250), { class: 'lake', name: 'Kleiner See' }));
  // A few places for the category search, at known distances from CENTER.
  layers.poi.push(
    point(m(60, 40), {
      class: 'restaurant',
      subclass: 'restaurant',
      name: 'Zur Letzten Instanz',
      rank: 1,
    }),
    point(m(-300, 200), { class: 'restaurant', subclass: 'restaurant', name: 'Curry 36', rank: 2 }),
    point(m(500, -400), {
      class: 'restaurant',
      subclass: 'restaurant',
      name: 'Borchardt',
      rank: 3,
    }),
    point(m(-120, -90), { class: 'grocery', subclass: 'supermarket', name: 'Kiezmarkt', rank: 1 }),
    point(m(250, 300), {
      class: 'grocery',
      subclass: 'bakery',
      name: 'Bäckerei Hoffmann',
      rank: 2,
    }),
    point(m(30, -60), {
      class: 'pharmacy',
      subclass: 'pharmacy',
      name: 'Linden-Apotheke',
      rank: 1,
    }),
    point(m(-400, 350), { class: 'museum', subclass: 'museum', name: 'Pergamonmuseum', rank: 1 }),
    point(m(200, -700), {
      class: 'school',
      subclass: 'kindergarten',
      name: 'Kita Sonnenschein',
      rank: 4,
    }),
    // A chain: two branches in view, written two ways.
    point(m(-250, -500), { class: 'shop', subclass: 'electronics', name: 'MediaMarkt', rank: 3 }),
    point(m(450, 600), { class: 'shop', subclass: 'electronics', name: 'Media Markt', rank: 3 }),
    // Public toilets rarely have a name in OpenStreetMap.
    point(m(-200, -250), { class: 'toilets', subclass: 'toilets', rank: 5 }),
  );
  layers.landuse.push(poly([rect(-2500, -2500, 2500, 2500)], { class: 'residential' }));
  layers.landcover.push(
    poly([rect(350, 750, 1250, 1500)], { class: 'grass', subclass: 'park' }),
    poly([rect(-2500, 1700, -1600, 2500)], { class: 'wood' }),
  );
  layers.park.push(poly([rect(1700, 1500, 2500, 2500)], { class: 'nature_reserve' }));

  const road = (pts: Position[], cls: string, name?: string, extra: Props = {}) => {
    layers.transportation.push(line(pts, { class: cls, ...extra }));
    if (name) layers.transportation_name.push(line(pts, { class: cls, name }));
  };
  for (let x = -2400; x <= 2400; x += 220) road([m(x, -2500), m(x, 2500)], 'minor');
  for (let y = -2400; y <= 2400; y += 180)
    road([m(-2500, y), m(2500, y)], 'minor', y === -60 ? 'Dorotheenstraße' : undefined);
  road([m(-2500, -240), m(2500, -240)], 'primary', 'Unter den Linden');
  road([m(20, -2500), m(20, 2500)], 'secondary', 'Friedrichstraße');
  road([m(-680, -2500), m(-680, 2500)], 'tertiary', 'Wilhelmstraße');
  road([m(860, -2500), m(860, 2500)], 'tertiary', 'Oranienburger Straße');
  road([m(-2500, -1700), m(0, -1550), m(2500, -1700)], 'motorway', 'A 100');
  road([m(-2500, 2200), m(2500, 1800)], 'trunk', 'Bundesstraße 2');
  road([m(-200, 600), m(-200, 900), m(-400, 900)], 'service');
  road([m(400, 800), m(800, 1100), m(1200, 900)], 'path');
  road([m(-2500, 120), m(2500, 160)], 'rail', undefined, { brunnel: 'bridge' });
  // Under the navigation test's last leg, which runs west along y = -330.
  road([m(300, -330), m(-300, -330)], 'primary', undefined, { brunnel: 'tunnel' });

  for (let bx = -2400; bx < 2400; bx += 220) {
    for (let by = -2400; by < 2400; by += 180) {
      const cx = bx + 110;
      const cy = by + 90;
      if (Math.abs(cy - riverY(cx)) < 140) continue;
      if (cx > 300 && cx < 1300 && cy > 700 && cy < 1550) continue;
      if (Math.hypot(cx + 1250, (cy - 1250) / 0.8) < 320) continue;
      for (const [dx, dy] of [
        [-50, -35],
        [50, -35],
        [-50, 35],
        [50, 35],
      ]) {
        const w = 32 + rand() * 24;
        const h = 22 + rand() * 18;
        const x = cx + dx;
        const y = cy + dy;
        layers.building.push(
          poly([rect(x - w / 2, y - h / 2, x + w / 2, y + h / 2)], {
            render_height: Math.round(12 + rand() * 30),
            render_min_height: 0,
          }),
        );
      }
      if (rand() > 0.85)
        layers.housenumber.push(
          point(m(cx - 50, cy - 70), { housenumber: String(1 + Math.floor(rand() * 90)) }),
        );
    }
  }
  layers.poi.push(
    point(m(140, -170), { class: 'cafe', name: 'Café Einstein', rank: 5 }),
    point(m(-320, 520), { class: 'museum', name: 'Museum für Naturkunde', rank: 2 }),
    point(m(60, 230), { class: 'railway', name: 'Bahnhof Friedrichstraße', rank: 1 }),
    point(m(-1000, -330), { class: 'attraction', name: 'Brandenburger Tor', rank: 1 }),
  );
  layers.place.push(
    point(m(-900, -650), { class: 'suburb', name: 'Mitte', rank: 10 }),
    point(m(1300, -1250), { class: 'suburb', name: 'Kreuzberg', rank: 10 }),
    point(m(-1700, 700), { class: 'neighbourhood', name: 'Moabit', rank: 12 }),
  );
  layers.mountain_peak.push(point(m(1500, -2100), { name: 'Kreuzberg', ele: 66, rank: 1 }));
  return layers;
}

/** All layers, the world and the city merged. */
export function scene(): Layers {
  const out: Layers = {};
  for (const part of [world(), city()]) {
    for (const [name, features] of Object.entries(part)) (out[name] ??= []).push(...features);
  }
  return out;
}
