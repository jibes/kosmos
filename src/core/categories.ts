import { TABLE } from './categoryTable';
import { distance, type LngLat } from './geo';
import { PLACE_WORDS } from './placeWords';

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

/** Typing slips forgiven: one from 6 letters ("kindergaten"), two from 10. */
const slips = (n: number) => (n >= 10 ? 2 : n >= 6 ? 1 : 0);

/**
 * Edits between two words (a letter added, dropped, changed, or two swapped), or more than
 * `max` once it is clear there are more.
 */
export function edits(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let least = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, prev2[j - 2] + 1);
      }
      row.push(d);
      least = Math.min(least, d);
    }
    if (least > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

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
 * The categories a query may mean misspelt ("kindergaten"), closest first, when it names none
 * as typed: a guess, so it comes after the places found by name ("Charité" is no charity).
 */
export function misspeltFor(query: string, limit = 1): Category[] {
  const q = fold(query);
  const max = slips(q.length);
  if (!max || categoriesFor(q).length) return [];
  const score = (c: Category) =>
    Math.min(
      ...WORDS[c].map((w) =>
        Math.min(
          edits(q, w, max),
          // A beginning misspelt ("kindergat") counts a little less than a whole word.
          w.length > q.length ? edits(q, w.slice(0, q.length), max) + 0.5 : Infinity,
        ),
      ),
    );
  return CATEGORY_IDS.map((c) => ({ c, d: score(c) }))
    .filter(({ d }) => d <= max + 0.5)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ c }) => c);
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

/**
 * What the map is searched for: a kind of place, or the places whose name begins so
 * ("name:MediaMarkt"), a chain or a name several places share.
 */
export type Kind = Category | `name:${string}`;
export const byName = (name: string): Kind => `name:${name}`;
export const nameOf = (k: Kind): string | null => (k.startsWith('name:') ? k.slice(5) : null);

/** A name to compare by: "Media Markt", "MediaMarkt" and "mediamarkt" are one. */
export const squeeze = (s: string) => fold(s).replace(/[^\p{L}\p{N}]/gu, '');

/** A name typed counts from 3 letters, as a kind's beginning does. */
export const NAME_MIN = 3;

/**
 * The name several places in view share that the query begins, and how many there are:
 * "media" → "MediaMarkt", 3. The name is the one most of them have, cut back to what all of
 * them begin with ("EDEKA Müller", "EDEKA Schmidt" → "EDEKA"). Under two places, Photon's names
 * are enough.
 */
export function sharedName(query: string, names: string[]): { name: string; n: number } | null {
  const q = squeeze(query);
  if (q.length < NAME_MIN) return null;
  const hits = names.filter((n) => squeeze(n).startsWith(q));
  if (hits.length < 2) return null;
  const count = new Map<string, number>();
  for (const n of hits) count.set(n, (count.get(n) ?? 0) + 1);
  const [top] = [...count].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
  let words = top[0].split(/\s+/);
  const allBegin = (name: string) => hits.every((n) => squeeze(n).startsWith(squeeze(name)));
  while (words.length > 1 && !allBegin(words.join(' '))) words = words.slice(0, -1);
  const name = words.join(' ');
  return { name: allBegin(name) ? name : query.trim(), n: hits.length };
}
