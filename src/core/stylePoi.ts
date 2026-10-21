import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Palette } from './palette';
import {
  POI_GROUP,
  POI_SUBCLASSES,
  SHOP_CLASSES,
  type PlaceKind,
  type PoiGroup,
} from './placeKind';

type Expr = ExpressionSpecification;

/** The image of a kind of place, drawn by the app (`ui/poiIcons.ts`) when a style asks. */
export const POI_ICON_PREFIX = 'poi-';

/** A `poi` feature's kind with an icon, else `''`: by its subclass, then a shop by its class. */
const kindOf: Expr = [
  'match',
  ['get', 'subclass'],
  ...Object.entries(POI_SUBCLASSES).flatMap(([kind, values]) => [values!, kind]),
  ['match', ['get', 'class'], SHOP_CLASSES, 'shop', ''],
] as unknown as Expr;

const COLOUR: Record<PoiGroup, keyof Palette> = {
  transport: 'poiTransport',
  food: 'poiFood',
  shop: 'poiShop',
  culture: 'poiCulture',
  park: 'poiPark',
  health: 'poiHealth',
  other: 'poiOther',
};

/**
 * The icon on each of the map's own places, a disc in its kind's colour with the kind drawn
 * out of it, so a café or a station is told apart before its name is read. Places of no
 * known kind keep their name alone.
 */
export function poiIcon(p: Palette) {
  const kinds = Object.keys(POI_GROUP) as PlaceKind[];
  return {
    layout: {
      'icon-image': ['case', ['==', kindOf, ''], '', ['concat', POI_ICON_PREFIX, kindOf]] as Expr,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.75, 18, 0.95] as Expr,
    },
    paint: {
      'icon-color': [
        'match',
        kindOf,
        ...kinds.flatMap((k) => [k, p[COLOUR[POI_GROUP[k]!]] as string]),
        p.labelMinor,
      ] as unknown as Expr,
      'icon-halo-color': p.halo,
      'icon-halo-width': 1,
    },
  };
}
