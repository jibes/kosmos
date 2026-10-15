import type {
  ExpressionSpecification,
  FilterSpecification,
  FontFacesSpecification,
  LayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import { palettes, type Palette, type Theme } from './palette';

/** OpenMapTiles-schema vector tiles, free and keyless. */
export const TILES_URL = 'https://tiles.openfreemap.org/planet';
/** Fallback glyphs for scripts the self-hosted label fonts do not cover. */
export const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/**
 * Label font stacks. The names match the glyph server's fonts, so any codepoint the declared
 * `font-faces` do not cover falls back to the same family in the same weight.
 */
export const FONT = {
  regular: 'Noto Sans Regular',
  bold: 'Noto Sans Bold',
  italic: 'Noto Sans Italic',
} as const;

/** Layers whose features can be tapped to select a place. */
export const LABEL_LAYERS = [
  'search-names',
  'search-dots',
  'label-poi',
  'label-village',
  'label-town',
  'label-city',
  'label-suburb',
  'label-water',
  'label-water-line',
  'label-peak',
] as const;

/** The OpenMapTiles vector source. */
export const MAP_SOURCE = 'omt';
/** GeoJSON source the app fills with routes; features carry `alt: true` for alternatives. */
export const ROUTE_SOURCE = 'route';
/** Places found by category, drawn as dots until the search is cleared. */
export const SEARCH_SOURCE = 'search';
export const ROUTE_ALT_LAYER = 'route-alt';

export interface StyleOptions {
  theme: Theme;
  /** UI language; place names prefer `name:<lang>`, roads keep the local name. */
  lang: string;
  fontFaces?: FontFacesSpecification;
}

type Expr = ExpressionSpecification;

const ZOOMS = [5, 8, 11, 14, 17, 20] as const;

const ROAD_WIDTHS: Record<string, readonly number[]> = {
  motorway: [0.7, 1.3, 2.4, 6, 14, 40],
  trunk: [0.6, 1.1, 2.1, 5.2, 13, 36],
  primary: [0.4, 0.9, 1.8, 4.6, 12, 32],
  secondary: [0, 0.6, 1.4, 4, 10.5, 28],
  tertiary: [0, 0.4, 1.1, 3.4, 9.5, 26],
  minor: [0, 0, 0.6, 2.2, 7.5, 22],
  service: [0, 0, 0, 1, 4, 12],
  busway: [0, 0, 0, 1, 4, 12],
};
/** Casing outset per zoom stop, added to the fill width. */
const CASING = [0, 0, 0.8, 1.6, 2.4, 3.2] as const;
const ROAD_CLASSES = Object.keys(ROAD_WIDTHS);
const ROAD_RANK: Record<string, number> = {
  motorway: 7,
  trunk: 6,
  primary: 5,
  secondary: 4,
  tertiary: 3,
  minor: 2,
  service: 1,
  busway: 1,
};

const cls: Expr = ['get', 'class'];

function byClass<T extends string | number>(values: Record<string, T>, fallback: T): Expr {
  const branches = Object.entries(values).flatMap(([k, v]) => [k, v]);
  return ['match', cls, ...branches, fallback] as unknown as Expr;
}

function roadWidth(casing: boolean): Expr {
  const stops = ZOOMS.flatMap((z, i) => {
    const widths = Object.fromEntries(
      ROAD_CLASSES.map((c) => {
        const w = ROAD_WIDTHS[c][i];
        return [c, w > 0 && casing ? w + CASING[i] : w];
      }),
    );
    return [z, byClass(widths, 0)];
  });
  return ['interpolate', ['exponential', 1.5], ['zoom'], ...stops] as unknown as Expr;
}

function roadColor(p: Palette): Expr {
  const low = byClass({ motorway: p.motorwayLow, trunk: p.motorwayLow }, p.roadLow);
  const high = byClass(
    { motorway: p.motorway, trunk: p.roadMajor, primary: p.roadMajor, secondary: p.roadMajor },
    p.roadMinor,
  );
  return ['interpolate', ['linear'], ['zoom'], 10, low, 12.5, high];
}

function casingColor(p: Palette): Expr {
  return byClass(
    { motorway: p.motorwayCase, trunk: p.roadMajorCase, primary: p.roadMajorCase },
    p.roadMinorCase,
  );
}

const lerp = (z0: number, v0: number, z1: number, v1: number): Expr => [
  'interpolate',
  ['linear'],
  ['zoom'],
  z0,
  v0,
  z1,
  v1,
];

const expLerp = (...stops: number[]): Expr =>
  ['interpolate', ['exponential', 1.5], ['zoom'], ...stops] as unknown as Expr;

const isLine: Expr = ['==', ['geometry-type'], 'LineString'];
const isPoint: Expr = ['==', ['geometry-type'], 'Point'];
const notTunnel: Expr = ['!=', ['get', 'brunnel'], 'tunnel'];
const hasName: Expr = ['has', 'name'];

function name(lang: string): Expr {
  return ['coalesce', ['get', `name:${lang}`], ['get', 'name']];
}

function base(p: Palette): LayerSpecification[] {
  return [
    { id: 'land', type: 'background', paint: { 'background-color': p.land } },
    {
      id: 'landcover',
      type: 'fill',
      source: MAP_SOURCE,
      'source-layer': 'landcover',
      filter: ['match', cls, ['wood', 'grass', 'ice', 'sand', 'wetland'], true, false],
      paint: {
        'fill-color': byClass(
          { wood: p.wood, grass: p.grass, ice: p.ice, sand: p.sand, wetland: p.wetland },
          p.land,
        ),
        'fill-opacity': lerp(0, 0.6, 9, 1),
      },
    },
    {
      id: 'landuse',
      type: 'fill',
      source: MAP_SOURCE,
      'source-layer': 'landuse',
      paint: {
        'fill-color': byClass(
          {
            residential: p.residential,
            suburb: p.residential,
            neighbourhood: p.residential,
            commercial: p.built,
            industrial: p.built,
            retail: p.built,
            railway: p.built,
            hospital: p.built,
            school: p.built,
            university: p.built,
            college: p.built,
            cemetery: p.grass,
            pitch: p.park,
            stadium: p.park,
            playground: p.park,
            park: p.park,
            garden: p.park,
          },
          'rgba(0,0,0,0)',
        ),
        'fill-opacity': lerp(8, 0, 12, 1),
      },
    },
    {
      id: 'park',
      type: 'fill',
      source: MAP_SOURCE,
      'source-layer': 'park',
      paint: { 'fill-color': p.park, 'fill-opacity': lerp(6, 0.25, 12, 0.7) },
    },
    {
      id: 'aeroway',
      type: 'fill',
      source: MAP_SOURCE,
      'source-layer': 'aeroway',
      minzoom: 11,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': p.aeroway },
    },
    {
      id: 'runway',
      type: 'line',
      source: MAP_SOURCE,
      'source-layer': 'aeroway',
      minzoom: 11,
      filter: ['all', isLine, ['match', cls, ['runway', 'taxiway'], true, false]],
      paint: {
        'line-color': p.aeroway,
        'line-width': [
          'interpolate',
          ['exponential', 1.5],
          ['zoom'],
          11,
          byClass({ runway: 1.5 }, 0.3),
          17,
          byClass({ runway: 60 }, 12),
        ],
      },
    },
    {
      id: 'water',
      type: 'fill',
      source: MAP_SOURCE,
      'source-layer': 'water',
      paint: { 'fill-color': p.water },
    },
    {
      id: 'waterway',
      type: 'line',
      source: MAP_SOURCE,
      'source-layer': 'waterway',
      minzoom: 8,
      filter: notTunnel,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': p.waterway,
        'line-width': [
          'interpolate',
          ['exponential', 1.4],
          ['zoom'],
          8,
          byClass({ river: 0.6, canal: 0.5 }, 0),
          13,
          byClass({ river: 2, canal: 1.6 }, 0.6),
          18,
          byClass({ river: 10, canal: 8 }, 3),
        ],
      },
    },
  ];
}

function roads(p: Palette): LayerSpecification[] {
  const roadFilter: FilterSpecification = [
    'all',
    isLine,
    ['match', cls, ROAD_CLASSES, true, false],
  ];
  const sortKey: Expr = byClass(ROAD_RANK, 0);
  const tunnelFade: Expr = ['match', ['get', 'brunnel'], 'tunnel', 0.45, 1];
  return [
    {
      id: 'path',
      type: 'line',
      source: MAP_SOURCE,
      'source-layer': 'transportation',
      minzoom: 14,
      filter: ['all', isLine, ['match', cls, ['path', 'track'], true, false]],
      paint: {
        'line-color': p.path,
        'line-width': lerp(14, 0.7, 18, 1.8),
        'line-dasharray': [2, 1.5],
      },
    },
    {
      id: 'rail',
      type: 'line',
      source: MAP_SOURCE,
      'source-layer': 'transportation',
      minzoom: 10,
      filter: ['all', isLine, notTunnel, ['match', cls, ['rail', 'transit'], true, false]],
      paint: { 'line-color': p.rail, 'line-width': lerp(10, 0.6, 18, 2.2) },
    },
    {
      id: 'ferry',
      type: 'line',
      source: MAP_SOURCE,
      'source-layer': 'transportation',
      minzoom: 9,
      filter: ['all', isLine, ['==', cls, 'ferry']],
      paint: { 'line-color': p.waterway, 'line-width': 1, 'line-dasharray': [3, 3] },
    },
    {
      id: 'road-casing',
      type: 'line',
      source: MAP_SOURCE,
      'source-layer': 'transportation',
      minzoom: 10,
      filter: roadFilter,
      layout: { 'line-cap': 'butt', 'line-join': 'round', 'line-sort-key': sortKey },
      paint: {
        'line-color': casingColor(p),
        'line-width': roadWidth(true),
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 12, tunnelFade],
      },
    },
    {
      id: 'road',
      type: 'line',
      source: MAP_SOURCE,
      'source-layer': 'transportation',
      filter: roadFilter,
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': sortKey },
      paint: {
        'line-color': roadColor(p),
        'line-width': roadWidth(false),
        'line-opacity': tunnelFade,
      },
    },
    {
      id: 'building',
      type: 'fill-extrusion',
      source: MAP_SOURCE,
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': p.building,
        'fill-extrusion-height': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          0,
          15.5,
          ['coalesce', ['get', 'render_height'], 6],
        ],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': lerp(14, 0, 15, 0.92),
        'fill-extrusion-vertical-gradient': false,
      },
    },
    {
      id: 'boundary-state',
      type: 'line',
      source: MAP_SOURCE,
      'source-layer': 'boundary',
      minzoom: 3,
      filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': p.boundaryState,
        'line-width': lerp(3, 0.5, 10, 1.2),
        'line-dasharray': [3, 2],
      },
    },
    {
      id: 'boundary-country',
      type: 'line',
      source: MAP_SOURCE,
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': p.boundary,
        'line-width': lerp(1, 0.6, 10, 1.6),
        'line-dasharray': [
          'case',
          ['==', ['get', 'disputed'], 1],
          ['literal', [2, 2]],
          ['literal', [1]],
        ],
      },
    },
  ];
}

function route(p: Palette): LayerSpecification[] {
  const width = (k: number): Expr => expLerp(8, 3 * k, 13, 6 * k, 18, 16 * k);
  const isAlt: Expr = ['==', ['get', 'alt'], true];
  // Public transport: walks are dotted, rides take their line's colour.
  const isWalk: Expr = ['==', ['get', 'walk'], true];
  const main: Expr = ['all', isLine, ['!', isAlt], ['!', isWalk]];
  const join = { 'line-cap': 'round', 'line-join': 'round' } as const;
  return [
    {
      id: ROUTE_ALT_LAYER,
      type: 'line',
      source: ROUTE_SOURCE,
      filter: ['all', isLine, isAlt],
      layout: join,
      paint: { 'line-color': p.routeAlt, 'line-width': width(0.8) },
    },
    {
      id: 'route-casing',
      type: 'line',
      source: ROUTE_SOURCE,
      filter: main,
      layout: join,
      paint: { 'line-color': p.routeCasing, 'line-width': width(1.45) },
    },
    {
      id: 'route-walk',
      type: 'line',
      source: ROUTE_SOURCE,
      filter: ['all', isLine, ['!', isAlt], isWalk],
      layout: join,
      paint: { 'line-color': p.accent, 'line-width': width(0.6), 'line-dasharray': [0.1, 1.8] },
    },
    {
      id: 'route-line',
      type: 'line',
      source: ROUTE_SOURCE,
      filter: main,
      layout: join,
      paint: { 'line-color': ['coalesce', ['get', 'color'], p.accent], 'line-width': width(1) },
    },
    {
      id: 'route-stops',
      type: 'circle',
      source: ROUTE_SOURCE,
      filter: ['all', isPoint, ['!', isAlt]],
      paint: {
        'circle-radius': expLerp(10, 3, 16, 6),
        'circle-color': p.routeCasing,
        'circle-stroke-color': p.label,
        'circle-stroke-width': 2,
      },
    },
  ];
}

/** Category results: a dot and its name, above the map's own labels so neither hides. */
function searchDots(p: Palette): LayerSpecification[] {
  return [
    {
      id: 'search-dots',
      type: 'circle',
      source: SEARCH_SOURCE,
      paint: {
        'circle-radius': expLerp(12, 4, 18, 6),
        'circle-color': p.accent,
        'circle-stroke-color': p.routeCasing,
        'circle-stroke-width': 2,
      },
    },
    {
      id: 'search-names',
      type: 'symbol',
      source: SEARCH_SOURCE,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [FONT.bold],
        'text-size': 12.5,
        'text-anchor': 'top',
        'text-offset': [0, 0.7],
        'text-max-width': 8,
      },
      paint: { 'text-color': p.accent, 'text-halo-color': p.halo, 'text-halo-width': 1.6 },
    },
  ];
}

function labels(p: Palette, lang: string): LayerSpecification[] {
  const halo = {
    'text-halo-color': p.halo,
    'text-halo-width': 1.5,
    'text-halo-blur': 0.5,
  };
  const place = (
    id: string,
    classes: string[],
    minzoom: number,
    maxzoom: number,
    size: Expr,
    opts: {
      font?: string;
      color?: string;
      caps?: boolean;
      spacing?: number;
    } = {},
  ): LayerSpecification => ({
    id,
    type: 'symbol',
    source: MAP_SOURCE,
    'source-layer': 'place',
    minzoom,
    maxzoom,
    filter: ['match', cls, classes, true, false],
    layout: {
      'text-field': name(lang),
      'text-font': [opts.font ?? FONT.regular],
      'text-size': size,
      'text-max-width': 8,
      'text-letter-spacing': opts.spacing ?? 0,
      'text-transform': opts.caps ? 'uppercase' : 'none',
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
      'text-padding': 4,
    },
    paint: { 'text-color': opts.color ?? p.label, ...halo },
  });
  // Bigger for important places (low rank) at every zoom.
  const ranked = (z: number, big: number, mid: number, small: number): (number | Expr)[] => [
    z,
    ['step', ['coalesce', ['get', 'rank'], 10], big, 4, mid, 8, small],
  ];
  const rankedSize = (...stops: (number | Expr)[]): Expr =>
    ['interpolate', ['linear'], ['zoom'], ...stops] as unknown as Expr;

  return [
    {
      id: 'label-water-line',
      type: 'symbol',
      source: MAP_SOURCE,
      'source-layer': 'waterway',
      minzoom: 12,
      filter: ['all', hasName, isLine],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [FONT.italic],
        'text-size': lerp(12, 10, 17, 13),
        'symbol-placement': 'line',
        'text-letter-spacing': 0.1,
        'symbol-spacing': 500,
      },
      paint: { 'text-color': p.labelWater, ...halo, 'text-halo-color': p.water },
    },
    {
      id: 'label-road',
      type: 'symbol',
      source: MAP_SOURCE,
      'source-layer': 'transportation_name',
      minzoom: 13,
      filter: ['all', hasName, isLine],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [FONT.regular],
        'text-size': lerp(13, 10, 18, 13.5),
        'symbol-placement': 'line',
        'text-max-angle': 30,
        'symbol-spacing': 350,
        'text-padding': 2,
      },
      paint: { 'text-color': p.labelRoad, ...halo },
    },
    {
      id: 'label-housenumber',
      type: 'symbol',
      source: MAP_SOURCE,
      'source-layer': 'housenumber',
      minzoom: 17.5,
      layout: {
        'text-field': ['get', 'housenumber'],
        'text-font': [FONT.regular],
        'text-size': 10,
      },
      paint: { 'text-color': p.labelMinor, ...halo },
    },
    {
      id: 'label-poi',
      type: 'symbol',
      source: MAP_SOURCE,
      'source-layer': 'poi',
      minzoom: 15,
      filter: ['all', hasName, isPoint],
      // Below the place's point, not on it: a selected place's pin stands on the point, and a
      // category result's name takes this spot, so the map's own copy gives way to it.
      layout: {
        'text-field': name(lang),
        'text-font': [FONT.regular],
        'text-size': lerp(15, 10.5, 18, 12.5),
        'text-max-width': 7,
        'text-anchor': 'top',
        'text-offset': [0, 0.6],
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
        'text-padding': 6,
      },
      paint: { 'text-color': p.labelMinor, ...halo },
    },
    {
      id: 'label-peak',
      type: 'symbol',
      source: MAP_SOURCE,
      'source-layer': 'mountain_peak',
      minzoom: 11,
      filter: hasName,
      layout: {
        'text-field': ['concat', '▲ ', name(lang)],
        'text-font': [FONT.regular],
        'text-size': 10.5,
        'text-max-width': 7,
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
      },
      paint: { 'text-color': p.labelMinor, ...halo },
    },
    {
      id: 'label-water',
      type: 'symbol',
      source: MAP_SOURCE,
      'source-layer': 'water_name',
      filter: ['all', hasName, isPoint],
      layout: {
        'text-field': name(lang),
        'text-font': [FONT.italic],
        'text-size': byClass({ ocean: 15, sea: 13 }, 11.5),
        'text-letter-spacing': byClass({ ocean: 0.3, sea: 0.2 }, 0.05),
        'text-max-width': 6,
      },
      paint: { 'text-color': p.labelWater, ...halo, 'text-halo-color': p.water },
    },
    place('label-suburb', ['suburb', 'quarter', 'neighbourhood'], 12, 16, lerp(12, 9.5, 15, 11.5), {
      color: p.labelMinor,
      caps: true,
      spacing: 0.12,
    }),
    place('label-village', ['village', 'hamlet'], 10, 17, lerp(10, 10.5, 15, 14.5)),
    place('label-town', ['town'], 7, 16, lerp(7, 11, 14, 16.5)),
    place(
      'label-city',
      ['city'],
      3,
      15,
      rankedSize(
        ...ranked(4, 13, 11.5, 10.5),
        ...ranked(8, 17.5, 15, 13),
        ...ranked(12, 22, 19, 16),
      ),
      { font: FONT.bold },
    ),
    place('label-state', ['state'], 4, 8, lerp(4, 9.5, 7, 11.5), {
      color: p.labelMinor,
      caps: true,
      spacing: 0.15,
    }),
    place(
      'label-country',
      ['country'],
      1,
      7,
      rankedSize(...ranked(2, 12, 10.5, 9.5), ...ranked(6, 16, 14, 12)),
      { font: FONT.bold, caps: true, spacing: 0.12 },
    ),
    place('label-continent', ['continent'], 0, 2, lerp(0, 11, 2, 14), {
      color: p.labelMinor,
      caps: true,
      spacing: 0.35,
    }),
  ];
}

export function buildStyle({ theme, lang, fontFaces }: StyleOptions): StyleSpecification {
  const p = palettes[theme];
  return {
    version: 8,
    name: `kOSMos ${theme}`,
    sources: {
      [MAP_SOURCE]: {
        type: 'vector',
        url: TILES_URL,
        attribution:
          '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      },
      [ROUTE_SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      [SEARCH_SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    glyphs: GLYPHS_URL,
    ...(fontFaces ? { 'font-faces': fontFaces } : {}),
    projection: { type: 'globe' },
    sky: {
      'sky-color': p.sky,
      'horizon-color': p.horizon,
      'fog-color': p.land,
      'sky-horizon-blend': 0.4,
      'horizon-fog-blend': 0.8,
      'fog-ground-blend': 0.9,
      // The atmosphere's sun glare fights the flat palette; a clean disc in space reads calmer.
      'atmosphere-blend': 0,
    },
    light: { anchor: 'viewport', color: '#ffffff', intensity: p.light, position: [1.2, 210, 35] },
    transition: { duration: 300, delay: 0 },
    layers: [...base(p), ...roads(p), ...route(p), ...labels(p, lang), ...searchDots(p)],
  };
}
