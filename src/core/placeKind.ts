/**
 * What kind of place a search result is, for the small icon on its row: a station looks like
 * one before its name is read. From Photon's OSM key and value, or the map's `poi` subclass.
 */
export type PlaceKind =
  | 'train'
  | 'subway'
  | 'tram'
  | 'bus'
  | 'ferry'
  | 'plane'
  | 'food'
  | 'cafe'
  | 'drink'
  | 'shop'
  | 'stay'
  | 'culture'
  | 'park'
  | 'health'
  | 'school'
  | 'town'
  | 'street'
  | 'address'
  /** One of the user's contacts, at their address. */
  | 'person'
  | 'place';

/** By value alone: the map's subclasses, and OSM values that mean the same under any key. */
const BY_VALUE: Record<string, PlaceKind> = {
  station: 'train',
  halt: 'train',
  train_station_entrance: 'train',
  subway_entrance: 'subway',
  tram_stop: 'tram',
  bus_stop: 'bus',
  bus_station: 'bus',
  ferry_terminal: 'ferry',
  aerodrome: 'plane',
  terminal: 'plane',
  restaurant: 'food',
  fast_food: 'food',
  food_court: 'food',
  cafe: 'cafe',
  ice_cream: 'cafe',
  bar: 'drink',
  pub: 'drink',
  biergarten: 'drink',
  nightclub: 'drink',
  hotel: 'stay',
  hostel: 'stay',
  guest_house: 'stay',
  motel: 'stay',
  apartment: 'stay',
  camp_site: 'stay',
  caravan_site: 'stay',
  museum: 'culture',
  gallery: 'culture',
  attraction: 'culture',
  viewpoint: 'culture',
  artwork: 'culture',
  theatre: 'culture',
  cinema: 'culture',
  arts_centre: 'culture',
  zoo: 'culture',
  castle: 'culture',
  monument: 'culture',
  place_of_worship: 'culture',
  park: 'park',
  garden: 'park',
  playground: 'park',
  nature_reserve: 'park',
  hospital: 'health',
  clinic: 'health',
  doctors: 'health',
  dentist: 'health',
  pharmacy: 'health',
  school: 'school',
  kindergarten: 'school',
  university: 'school',
  college: 'school',
  library: 'school',
};

const TOWNS = new Set([
  'city',
  'town',
  'village',
  'hamlet',
  'suburb',
  'quarter',
  'neighbourhood',
  'borough',
  'municipality',
  'county',
  'state',
  'country',
  'locality',
  'district',
]);

/**
 * A Photon hit's kind: its OSM key and value first (every shop is a shop, a `place` a town,
 * any `highway` but a bus stop a street), else Photon's own type of the object.
 */
export function kindOfOsm(key?: string, value?: string, type?: string): PlaceKind {
  const v = value ?? '';
  if (key === 'public_transport') return v === 'station' ? 'train' : 'bus';
  if (key === 'highway') return v === 'bus_stop' ? 'bus' : 'street';
  if (key === 'shop') return 'shop';
  if (key === 'place' || (key === 'boundary' && v === 'administrative')) return 'town';
  if (key === 'historic') return 'culture';
  if (key === 'aeroway') return 'plane';
  const known = BY_VALUE[v];
  if (known) return known;
  if (type === 'street') return 'street';
  if (type === 'house') return 'address';
  if (type && TOWNS.has(type)) return 'town';
  return 'place';
}

/** A place from the map's tiles: by its `poi` subclass (and class, which says "shop"). */
export function kindOfPoi(p: Record<string, unknown>): PlaceKind {
  const known = BY_VALUE[String(p.subclass)];
  if (known) return known;
  if (SHOP_CLASSES.includes(String(p.class))) return 'shop';
  return 'place';
}

/** The kinds the map's own places show an icon for, each in its group's colour. */
export type PoiGroup = 'transport' | 'food' | 'shop' | 'culture' | 'park' | 'health' | 'other';
export const POI_GROUP: Partial<Record<PlaceKind, PoiGroup>> = {
  train: 'transport',
  subway: 'transport',
  tram: 'transport',
  bus: 'transport',
  ferry: 'transport',
  plane: 'transport',
  food: 'food',
  cafe: 'food',
  drink: 'food',
  shop: 'shop',
  culture: 'culture',
  park: 'park',
  health: 'health',
  stay: 'other',
  school: 'other',
};

/** The `poi` subclasses of each kind with an icon, and the classes that say "shop". */
export const POI_SUBCLASSES = Object.entries(BY_VALUE).reduce<Partial<Record<PlaceKind, string[]>>>(
  (out, [value, kind]) => {
    if (POI_GROUP[kind]) (out[kind] ??= []).push(value);
    return out;
  },
  {},
);
export const SHOP_CLASSES = ['shop', 'grocery', 'clothing_store'];
