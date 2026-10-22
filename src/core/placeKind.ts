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
  | 'fuel'
  | 'charging'
  | 'parking'
  | 'car'
  | 'bike'
  | 'money'
  | 'post'
  | 'police'
  | 'sport'
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
  bed_and_breakfast: 'stay',
  chalet: 'stay',
  alpine_hut: 'stay',
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
  ruins: 'culture',
  theme_park: 'culture',
  aquarium: 'culture',
  townhall: 'culture',
  courthouse: 'culture',
  community_centre: 'culture',
  park: 'park',
  garden: 'park',
  playground: 'park',
  nature_reserve: 'park',
  hospital: 'health',
  clinic: 'health',
  doctors: 'health',
  dentist: 'health',
  pharmacy: 'health',
  veterinary: 'health',
  school: 'school',
  kindergarten: 'school',
  university: 'school',
  college: 'school',
  library: 'school',
  fuel: 'fuel',
  charging_station: 'charging',
  parking: 'parking',
  motorcycle_parking: 'parking',
  car: 'car',
  car_repair: 'car',
  car_parts: 'car',
  car_rental: 'car',
  car_wash: 'car',
  taxi: 'car',
  bicycle: 'bike',
  bicycle_rental: 'bike',
  bicycle_parking: 'bike',
  bicycle_repair_station: 'bike',
  bank: 'money',
  atm: 'money',
  bureau_de_change: 'money',
  post_office: 'post',
  parcel_locker: 'post',
  post_box: 'post',
  police: 'police',
  sports_centre: 'sport',
  sports_hall: 'sport',
  fitness_centre: 'sport',
  pitch: 'sport',
  stadium: 'sport',
  ice_rink: 'sport',
  golf_course: 'sport',
  miniature_golf: 'sport',
  swimming_pool: 'sport',
  water_park: 'sport',
  swimming_area: 'sport',
  // Shops the map's tiles give a class of their own (not "shop"): a shop all the same.
  ...Object.fromEntries(
    [
      'supermarket',
      'convenience',
      'general',
      'deli',
      'delicatessen',
      'greengrocer',
      'frozen_food',
      'farm',
      'bakery',
      'butcher',
      'alcohol',
      'beverages',
      'wine',
      'kiosk',
      'newsagent',
      'tobacco',
      'marketplace',
      'chemist',
      'cosmetics',
      'perfumery',
      'optician',
      'hearing_aids',
      'hairdresser',
      'beauty',
      'tattoo',
      'laundry',
      'dry_cleaning',
      'clothes',
      'boutique',
      'shoes',
      'second_hand',
      'charity',
      'electronics',
      'computer',
      'mobile_phone',
      'doityourself',
      'hardware',
      'garden_centre',
      'florist',
      'furniture',
      'department_store',
      'mall',
      'books',
      'stationery',
      'toys',
      'sports',
      'outdoor',
      'jewelry',
      'gift',
      'pet',
      'music',
      'musical_instrument',
      'photo',
      'travel_agency',
    ].map((v) => [v, 'shop' as PlaceKind]),
  ),
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
  fuel: 'transport',
  charging: 'transport',
  parking: 'transport',
  car: 'transport',
  bike: 'transport',
  money: 'other',
  post: 'other',
  police: 'other',
  sport: 'park',
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
