import { distance, type LngLat } from './geo';

/**
 * Searching by kind of place ("restaurant", "Lebensmittel") instead of by name. The answer comes
 * from the map's own vector tiles (OpenMapTiles `poi` layer): no server, works offline, and
 * shows exactly what the map shows.
 */

export type Category = 'restaurant' | 'cafe' | 'groceries' | 'bar' | 'pharmacy' | 'fuel';

/** OSM values (OpenMapTiles `subclass`) that belong to each category, in chip order. */
export const CATEGORIES: Record<Category, readonly string[]> = {
  restaurant: ['restaurant', 'fast_food', 'food_court'],
  cafe: ['cafe', 'ice_cream'],
  groceries: [
    'supermarket',
    'convenience',
    'greengrocer',
    'bakery',
    'butcher',
    'deli',
    'organic',
    'grocery',
  ],
  bar: ['bar', 'pub', 'biergarten'],
  pharmacy: ['pharmacy', 'chemist'],
  fuel: ['fuel', 'charging_station'],
};

export const CATEGORY_IDS = Object.keys(CATEGORIES) as Category[];

/** Words that mean a category, in the UI languages; matched without case or accents. */
const WORDS: Record<Category, readonly string[]> = {
  restaurant: ['restaurant', 'restaurants', 'essen', 'food', 'imbiss', 'gaststatte', 'lokal'],
  cafe: ['cafe', 'cafes', 'coffee', 'kaffee', 'eis', 'ice cream'],
  groceries: [
    'lebensmittel',
    'supermarkt',
    'supermarket',
    'groceries',
    'grocery',
    'einkaufen',
    'backer',
    'backerei',
    'bakery',
  ],
  bar: ['bar', 'bars', 'kneipe', 'pub', 'biergarten'],
  pharmacy: ['apotheke', 'apotheken', 'pharmacy', 'pharmacies', 'drogerie', 'chemist'],
  fuel: ['tankstelle', 'tanken', 'fuel', 'gas station', 'petrol', 'laden', 'charging'],
};

export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** The category a query names, if any: a whole word, or the start of one from 4 letters. */
export function categoryFor(query: string): Category | null {
  const q = fold(query);
  if (q.length < 3) return null;
  for (const c of CATEGORY_IDS) {
    if (WORDS[c].some((w) => w === q || (q.length >= 4 && w.startsWith(q)))) return c;
  }
  return null;
}

/** MapLibre filter for the `poi` source layer: named places of the category. */
export function poiFilter(c: Category): unknown[] {
  return ['all', ['has', 'name'], ['in', ['get', 'subclass'], ['literal', CATEGORIES[c]]]];
}

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
