import { TABLE } from './categoryTable';
import { distance, type LngLat } from './geo';
import { PLACE_WORDS } from './placeWords';
import { poiType } from './placeKind';

/**
 * Searching by kind of place ("restaurant", "Lebensmittel") instead of by name. The answer comes
 * from the map's own vector tiles (OpenMapTiles `poi` layer): no server, works offline, and
 * shows exactly what the map shows.
 */

export type Category = keyof typeof TABLE;
export const CATEGORY_IDS = Object.keys(TABLE) as Category[];

export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    // "Straße" and "Strasse" are one word.
    .replace(/ß/g, 'ss')
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
 * Every word for each kind: its own, then iD's for its values. A value in a group and in a
 * kind of its own ("Groceries", "Bakeries") gives its words to the kind of its own, and a word
 * one kind names itself ("theater") is not another's because a preset lists it.
 */
const WORDS: Record<Category, readonly string[]> = (() => {
  const own = new Map<string, Category>();
  for (const c of CATEGORY_IDS) for (const w of TABLE[c].words) own.set(w, c);
  const home = new Map<string, Category>();
  for (const c of CATEGORY_IDS) {
    for (const tag of TABLE[c].tags) {
      const was = home.get(tag);
      if (!was || TABLE[c].tags.length < TABLE[was].tags.length) home.set(tag, c);
    }
  }
  const out = {} as Record<Category, readonly string[]>;
  for (const c of CATEGORY_IDS) {
    const words = new Set<string>(TABLE[c].words);
    for (const tag of TABLE[c].tags) {
      if (home.get(tag) !== c) continue;
      for (const w of PLACE_WORDS[tag]?.split('|') ?? []) {
        const of = own.get(w);
        if (!of || of === c) words.add(w);
      }
    }
    out[c] = [...words];
  }
  return out;
})();

/** Whether the text names a kind of place as it is ("Apotheke"), not just begins one. */
export const isCategoryWord = (text: string) => {
  const q = fold(text);
  return CATEGORY_IDS.some((c) => WORDS[c].includes(q));
};

/**
 * A beginning counts from 3 letters ("kir" → Kirche); a short word that is itself a kind of
 * place ("bar") offers no longer ones it begins ("barber").
 */
const PREFIX_MIN = 3;
const BESIDE_EXACT_MIN = 4;

/**
 * The categories a query may mean, best first: a word named exactly, else as its plural; then
 * words it begins. At most `limit`, so a short prefix does not crowd out places by name.
 */
export function categoriesFor(query: string, limit = 2): Category[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const named = (qs: string[]) => CATEGORY_IDS.filter((c) => qs.some((f) => WORDS[c].includes(f)));
  const whole = named([q]);
  const exact = whole.length ? whole : named(forms(q));
  const begun =
    q.length < (exact.length ? BESIDE_EXACT_MIN : PREFIX_MIN)
      ? []
      : CATEGORY_IDS.filter((c) => !exact.includes(c) && WORDS[c].some((w) => w.startsWith(q)));
  return [...exact, ...begun].slice(0, limit);
}

/**
 * Kinds of place that mostly have no name in OpenStreetMap (a public toilet, a cash machine, a
 * car park); found anyway, and called by what they are.
 */
export const UNNAMED = [
  'atm',
  'toilets',
  'parking',
  'bicycle_parking',
  'playground',
  'post_box',
  'drinking_water',
  'recycling',
  'charging_station',
  'taxi',
] as const;
export type Unnamed = (typeof UNNAMED)[number];

/** Whether a nameless place of this subclass is still worth finding: its kind is its name. */
export const unnamedKind = (subclass: unknown): Unnamed | undefined =>
  (UNNAMED as readonly unknown[]).includes(subclass) ? (subclass as Unnamed) : undefined;

/**
 * A place of the category, from a `poi` feature's properties: named, or of a nameless kind.
 * By what it is (`poiType`): a church's subclass is its faith, its class the place of worship.
 */
export const isOf = (c: Category, p: Record<string, unknown>): boolean =>
  (!!p.name || !!unnamedKind(p.subclass)) &&
  (TABLE[c].tags as readonly unknown[]).includes(poiType(p));

export interface Poi extends LngLat {
  name: string;
  subclass?: string;
}

/** Places shown for a kind at most: the map's labels thin out by themselves, the list scrolls. */
export const SHOWN_MAX = 60;

/**
 * The nearest places first, each once: tiles overlap at their edges, so the same place can
 * come back twice from neighbouring tiles.
 */
export function nearest<T extends Poi>(
  pois: T[],
  from: LngLat,
  limit = SHOWN_MAX,
): (T & { m: number })[] {
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

/** What the map is searched for: a kind of place, or the places Photon found by name. */
export type Kind = Category | `found:${string}`;
/**
 * Places found by name, all shown at once (Enter without picking one of several): Photon's
 * answer to the text, not a search of the map.
 */
export const foundFor = (text: string): Kind => `found:${text}`;
export const foundOf = (k: Kind): string | null => (k.startsWith('found:') ? k.slice(6) : null);

/** A view of several places found by name stays within this of the best: not the next town. */
export const FOUND_NEAR_M = 30_000;

/** The places to fit when showing them all: the best one and those near it. */
export const nearBest = <T extends LngLat>(places: T[]): T[] =>
  places.filter((p) => distance(places[0], p) <= FOUND_NEAR_M);
