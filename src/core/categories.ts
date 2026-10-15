import { distance, type LngLat } from './geo';

/**
 * Searching by kind of place ("restaurant", "Lebensmittel") instead of by name. The answer comes
 * from the map's own vector tiles (OpenMapTiles `poi` layer): no server, works offline, and
 * shows exactly what the map shows.
 */

/**
 * Each kind of place: the OSM values (OpenMapTiles `subclass`) that belong to it, and the words
 * that name it in the UI languages, without case or accents.
 */
const TABLE = {
  restaurant: {
    tags: ['restaurant', 'fast_food', 'food_court'],
    words: ['restaurant', 'restaurants', 'essen', 'food', 'imbiss', 'gaststatte', 'lokal'],
  },
  cafe: {
    tags: ['cafe', 'ice_cream'],
    words: ['cafe', 'cafes', 'coffee', 'kaffee', 'eis', 'eiscafe', 'ice cream'],
  },
  bar: {
    tags: ['bar', 'pub', 'biergarten', 'nightclub'],
    words: ['bar', 'bars', 'kneipe', 'pub', 'pubs', 'biergarten', 'club', 'nightclub'],
  },
  groceries: {
    tags: [
      'supermarket',
      'convenience',
      'greengrocer',
      'bakery',
      'butcher',
      'deli',
      'organic',
      'grocery',
    ],
    words: [
      'lebensmittel',
      'supermarkt',
      'supermarket',
      'groceries',
      'grocery',
      'einkaufen',
      'backer',
      'backerei',
      'bakery',
      'metzger',
      'metzgerei',
      'fleischerei',
      'butcher',
    ],
  },
  pharmacy: {
    tags: ['pharmacy', 'chemist'],
    words: ['apotheke', 'apotheken', 'pharmacy', 'pharmacies', 'drogerie', 'chemist'],
  },
  doctor: {
    tags: ['hospital', 'clinic', 'doctors', 'dentist'],
    words: [
      'arzt',
      'arzte',
      'doctor',
      'doctors',
      'zahnarzt',
      'dentist',
      'krankenhaus',
      'klinik',
      'hospital',
      'clinic',
    ],
  },
  fuel: {
    tags: ['fuel', 'charging_station'],
    words: [
      'tankstelle',
      'tankstellen',
      'tanken',
      'fuel',
      'gas station',
      'petrol',
      'petrol station',
      'ladestation',
      'charging',
    ],
  },
  park: {
    tags: ['park', 'garden', 'nature_reserve'],
    words: ['park', 'parks', 'parkanlage', 'garten', 'garden', 'grunanlage', 'naturschutzgebiet'],
  },
  parking: {
    tags: ['parking', 'bicycle_parking'],
    words: ['parkplatz', 'parkplatze', 'parken', 'parkhaus', 'parking', 'car park'],
  },
  bank: {
    tags: ['bank', 'atm', 'bureau_de_change'],
    words: ['bank', 'banken', 'banks', 'geldautomat', 'atm', 'cash'],
  },
  post: {
    tags: ['post_office'],
    words: ['post', 'postamt', 'post office', 'postfiliale'],
  },
  toilets: {
    tags: ['toilets'],
    words: ['toilette', 'toiletten', 'wc', 'toilets', 'toilet', 'restroom'],
  },
  museum: {
    tags: ['museum', 'gallery', 'arts_centre'],
    words: ['museum', 'museen', 'museums', 'galerie', 'gallery', 'ausstellung', 'kunst', 'art'],
  },
  theatre: {
    tags: ['theatre', 'cinema'],
    words: ['theater', 'theatre', 'kino', 'kinos', 'cinema', 'oper', 'opera'],
  },
  sights: {
    tags: ['attraction', 'viewpoint', 'castle', 'monument', 'zoo', 'theme_park', 'aquarium'],
    words: [
      'sehenswurdigkeit',
      'sehenswurdigkeiten',
      'sights',
      'attraction',
      'attractions',
      'aussicht',
      'viewpoint',
      'burg',
      'schloss',
      'castle',
      'denkmal',
      'monument',
      'zoo',
    ],
  },
  hotel: {
    tags: ['hotel', 'hostel', 'guest_house', 'motel'],
    words: ['hotel', 'hotels', 'hostel', 'pension', 'unterkunft', 'ubernachtung', 'accommodation'],
  },
  library: {
    tags: ['library'],
    words: ['bibliothek', 'bucherei', 'library'],
  },
  worship: {
    tags: ['place_of_worship'],
    words: [
      'kirche',
      'church',
      'dom',
      'moschee',
      'mosque',
      'synagoge',
      'synagogue',
      'tempel',
      'temple',
    ],
  },
  school: {
    tags: ['school', 'kindergarten', 'university', 'college'],
    words: [
      'schule',
      'school',
      'kita',
      'kindergarten',
      'universitat',
      'university',
      'uni',
      'hochschule',
      'college',
    ],
  },
  sport: {
    tags: ['sports_centre', 'fitness_centre', 'swimming_pool', 'water_park'],
    words: [
      'sport',
      'fitness',
      'gym',
      'fitnessstudio',
      'schwimmbad',
      'hallenbad',
      'freibad',
      'swimming',
      'pool',
    ],
  },
  playground: {
    tags: ['playground'],
    words: ['spielplatz', 'spielplatze', 'playground'],
  },
  police: {
    tags: ['police'],
    words: ['polizei', 'police'],
  },
  hairdresser: {
    tags: ['hairdresser', 'beauty'],
    words: ['friseur', 'frisor', 'hairdresser', 'barber'],
  },
  bicycle: {
    tags: ['bicycle'],
    words: ['fahrrad', 'fahrradladen', 'radladen', 'bike shop', 'bicycle'],
  },
} as const satisfies Record<string, { tags: readonly string[]; words: readonly string[] }>;

export type Category = keyof typeof TABLE;
export const CATEGORY_IDS = Object.keys(TABLE) as Category[];

export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/**
 * A word and the forms it may stand for without its plural or inflection: "Supermärkte",
 * "Kirchen", "Krankenhäuser", "churches", "ATMs" find the word the table names.
 */
function forms(q: string): string[] {
  const out = [q];
  for (const end of ['ies', 'es', 'en', 'er', 'n', 's', 'e']) {
    if (q.length > end.length + 2 && q.endsWith(end)) out.push(q.slice(0, -end.length));
  }
  if (q.endsWith('ies')) out.push(`${q.slice(0, -3)}y`);
  return out;
}

/**
 * A beginning counts from 3 letters ("kir" → Kirche); a short word that is itself a kind of
 * place ("bar") offers no longer ones it begins ("barber").
 */
const PREFIX_MIN = 3;
const BESIDE_EXACT_MIN = 4;

/**
 * The categories a query may mean, best first: a word named exactly (or as its plural), then
 * words it begins. At most `limit`, so a short prefix does not crowd out places by name.
 */
export function categoriesFor(query: string, limit = 2): Category[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const qs = forms(q);
  const exact = CATEGORY_IDS.filter((c) =>
    qs.some((f) => (TABLE[c].words as readonly string[]).includes(f)),
  );
  const begun =
    q.length < (exact.length ? BESIDE_EXACT_MIN : PREFIX_MIN)
      ? []
      : CATEGORY_IDS.filter(
          (c) => !exact.includes(c) && TABLE[c].words.some((w) => w.startsWith(q)),
        );
  return [...exact, ...begun].slice(0, limit);
}

/**
 * Kinds of place that mostly have no name in OpenStreetMap (a public toilet, a cash machine, a
 * car park); found anyway, and called by what they are.
 */
export const UNNAMED = ['atm', 'toilets', 'parking', 'bicycle_parking', 'playground'] as const;
export type Unnamed = (typeof UNNAMED)[number];

/** Whether a nameless place of this subclass is still worth finding: its kind is its name. */
export const unnamedKind = (subclass: unknown): Unnamed | undefined =>
  (UNNAMED as readonly unknown[]).includes(subclass) ? (subclass as Unnamed) : undefined;

/** A place of the category, from a `poi` feature's properties: named, or of a nameless kind. */
export const isOf = (c: Category, p: Record<string, unknown>): boolean =>
  (!!p.name || !!unnamedKind(p.subclass)) &&
  (TABLE[c].tags as readonly unknown[]).includes(p.subclass);

export interface Poi extends LngLat {
  name: string;
  subclass?: string;
}

/**
 * The nearest places first, each once: tiles overlap at their edges, so the same place can
 * come back twice from neighbouring tiles.
 */
export function nearest<T extends Poi>(pois: T[], from: LngLat, limit = 20): (T & { m: number })[] {
  const seen = new Set<string>();
  return pois
    .map((p) => ({ ...p, m: distance(from, p) }))
    .sort((a, b) => a.m - b.m)
    .filter((p) => {
      const key = `${p.name}|${p.lng.toFixed(4)}|${p.lat.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
