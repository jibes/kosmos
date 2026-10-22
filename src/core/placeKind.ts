/**
 * What kind of place a search result is, for the small icon on its row: a station looks like
 * one before its name is read. From Photon's OSM key and value, or the map's `poi` subclass.
 */
export type PlaceKind =
  | 'train'
  | 'cable'
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
  | 'fire'
  | 'info'
  | 'cemetery'
  | 'toilets'
  | 'water'
  | 'recycling'
  | 'cinema'
  | 'library'
  | 'view'
  | 'civic'
  | 'camp'
  | 'theatre'
  | 'church'
  | 'mosque'
  | 'synagogue'
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
  camp_site: 'camp',
  caravan_site: 'camp',
  bed_and_breakfast: 'stay',
  chalet: 'stay',
  alpine_hut: 'stay',
  museum: 'culture',
  gallery: 'culture',
  attraction: 'culture',
  viewpoint: 'view',
  artwork: 'culture',
  theatre: 'theatre',
  cinema: 'cinema',
  arts_centre: 'culture',
  zoo: 'culture',
  castle: 'culture',
  monument: 'culture',
  place_of_worship: 'culture',
  memorial: 'culture',
  fountain: 'culture',
  ruins: 'culture',
  theme_park: 'culture',
  aquarium: 'culture',
  townhall: 'civic',
  courthouse: 'civic',
  community_centre: 'civic',
  embassy: 'civic',
  park: 'park',
  garden: 'park',
  playground: 'park',
  dog_park: 'park',
  picnic_site: 'park',
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
  library: 'library',
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
  fire_station: 'fire',
  information: 'info',
  cemetery: 'cemetery',
  grave_yard: 'cemetery',
  toilets: 'toilets',
  drinking_water: 'water',
  water_point: 'water',
  recycling: 'recycling',
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

/**
 * Classes whose `subclass` the tiles fill with a detail instead of the kind of place:
 * a place of worship's faith, an information point's sort, a pitch's sport (OpenMapTiles'
 * `layer_poi`). Their class is what they are.
 */
export const CLASS_IS_KIND = ['place_of_worship', 'information', 'pitch'];

/** What a `poi` feature is, as the kinds of place name it: `place_of_worship`, not `christian`. */
export const poiType = (p: Record<string, unknown>): string =>
  CLASS_IS_KIND.includes(String(p.class)) ? String(p.class) : String(p.subclass);

/** A place of worship by its faith; another faith keeps the building. */
export const BY_FAITH: Record<string, PlaceKind> = {
  christian: 'church',
  muslim: 'mosque',
  jewish: 'synagogue',
};

/** Read before the subclass: a cable car's station is no train station. */
export const BY_CLASS_FIRST: Record<string, PlaceKind> = {
  information: 'info',
  pitch: 'sport',
  aerialway: 'cable',
};

/** Read after the subclass: whatever the tiles' class says, when the subclass is unknown. */
export const BY_CLASS: Record<string, PlaceKind> = {
  shop: 'shop',
  grocery: 'shop',
  clothing_store: 'shop',
  alcohol_shop: 'shop',
  music: 'shop',
  restaurant: 'food',
  fast_food: 'food',
  cafe: 'cafe',
  ice_cream: 'cafe',
  bar: 'drink',
  beer: 'drink',
  lodging: 'stay',
  campsite: 'camp',
  hospital: 'health',
  school: 'school',
  college: 'school',
  stadium: 'sport',
  swimming: 'sport',
  golf: 'sport',
  castle: 'culture',
  art_gallery: 'culture',
  attraction: 'culture',
  monument: 'culture',
  museum: 'culture',
  theatre: 'theatre',
  zoo: 'culture',
  town_hall: 'civic',
  cemetery: 'cemetery',
  harbor: 'ferry',
  railway: 'train',
  bus: 'bus',
  car: 'car',
  bicycle: 'bike',
  post: 'post',
  park: 'park',
  garden: 'park',
  playground: 'park',
  dog_park: 'park',
};

/** A place from the map's tiles: by its class where that says more, else its subclass. */
export function kindOfPoi(p: Record<string, unknown>): PlaceKind {
  const cls = String(p.class);
  if (cls === 'place_of_worship') return BY_FAITH[String(p.subclass)] ?? 'culture';
  return BY_CLASS_FIRST[cls] ?? BY_VALUE[String(p.subclass)] ?? BY_CLASS[cls] ?? 'place';
}

/** The kinds the map's own places show an icon for, each in its group's colour. */
export type PoiGroup = 'transport' | 'food' | 'shop' | 'culture' | 'park' | 'health' | 'other';
export const POI_GROUP: Partial<Record<PlaceKind, PoiGroup>> = {
  train: 'transport',
  cable: 'transport',
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
  police: 'health',
  sport: 'park',
  fire: 'health',
  info: 'other',
  cemetery: 'park',
  toilets: 'other',
  water: 'other',
  recycling: 'other',
  cinema: 'culture',
  library: 'other',
  view: 'park',
  civic: 'other',
  camp: 'other',
  theatre: 'culture',
  church: 'culture',
  mosque: 'culture',
  synagogue: 'culture',
};

/** The `poi` subclasses of each kind with an icon. */
export const POI_SUBCLASSES = Object.entries(BY_VALUE).reduce<Partial<Record<PlaceKind, string[]>>>(
  (out, [value, kind]) => {
    if (POI_GROUP[kind]) (out[kind] ??= []).push(value);
    return out;
  },
  {},
);
