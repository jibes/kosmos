import { CATEGORY_IDS, fold, type Category, type Kind } from './categories';
import type { Contact } from './contacts';
import { titleOf, type Favourite } from './favourites';
import { distance, type LngLat } from './geo';
import type { Recent } from './recent';
import type { Place } from './search';

/**
 * The search list's rows. An empty field shows a row per list of the user's own (favourites,
 * contacts) and one for the kinds of place, each opening its list in the field's place (a
 * folder), then the recent searches; typing searches names, or within an open list only.
 */
export type Folder = 'favourites' | 'contacts' | 'kinds';

export type Item =
  | { type: 'cat'; cat: Kind }
  | { type: 'place'; place: Place; fav?: boolean; contact?: boolean; away?: number }
  | { type: 'recent'; recent: Recent }
  /** Contacts put on the map from the address book, or how many there are. */
  | { type: 'contacts' }
  /** Opens a list, with how many it holds. */
  | { type: 'folder'; folder: Folder; n: number }
  /** Back out of the open list. */
  | { type: 'up'; folder: Folder };

/** Offered first among the kinds of place: what people look for most. */
export const COMMON: Category[] = [
  'restaurant',
  'cafe',
  'groceries',
  'pharmacy',
  'toilets',
  'parking',
];

/** At most this many favourites and contacts each among the names typed. */
const TYPED_MAX = 3;

/** A name or a word of it begins with the text. */
export function matches(names: string[], query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  return names.some((n) => {
    const f = fold(n);
    return f.startsWith(q) || f.split(/\s+/).some((w) => w.startsWith(q));
  });
}

/** Favourites by the user's own name for them or the place's. */
export const matchFavourites = (list: Favourite[], query: string, limit = TYPED_MAX) =>
  query.trim().length < 2
    ? []
    : list.filter((f) => matches([titleOf(f), f.name], query)).slice(0, limit);

/** Nearest first, with how far each is; in the list's order without a place to count from. */
export function byDistance<T extends LngLat>(list: T[], from?: LngLat): { it: T; m?: number }[] {
  if (!from) return list.map((it) => ({ it }));
  return list.map((it) => ({ it, m: distance(from, it) })).sort((a, b) => a.m - b.m);
}

/** Every kind of place: the common ones first, then the rest by name. */
export function kindsInOrder(labelOf: (c: Category) => string): Category[] {
  const rest = CATEGORY_IDS.filter((c) => !COMMON.includes(c)).sort((a, b) =>
    labelOf(a).localeCompare(labelOf(b)),
  );
  return [...COMMON, ...rest];
}

export interface ListInput {
  query: string;
  folder: Folder | null;
  favourites: Favourite[];
  /** Placed contacts only count; `undefined` where contacts cannot be added (a route's end). */
  contacts?: Contact[];
  recent: Recent[];
  /** Kinds of place can be searched (not when choosing a route's end). */
  kinds: boolean;
  labelOf: (c: Category) => string;
  placeOf: (f: Favourite) => Place;
  placeOfContact: (c: Contact) => Place;
  /** Where distances count from. */
  from?: LngLat;
}

/** The rows of an open list: back first, then what it holds that matches the text. */
export function folderItems(o: ListInput & { folder: Folder }): Item[] {
  const up: Item = { type: 'up', folder: o.folder };
  if (o.folder === 'kinds') {
    return [
      up,
      ...kindsInOrder(o.labelOf)
        .filter((c) => matches([o.labelOf(c)], o.query))
        .map((cat): Item => ({ type: 'cat', cat })),
    ];
  }
  if (o.folder === 'favourites') {
    const found = o.favourites.filter((f) => matches([titleOf(f), f.name], o.query));
    return [
      up,
      ...byDistance(found, o.from).map(({ it, m }): Item => ({
        type: 'place',
        place: o.placeOf(it),
        fav: true,
        away: m,
      })),
    ];
  }
  const placed = (o.contacts ?? []).filter(
    (c): c is Contact & LngLat => c.lng !== undefined && c.lat !== undefined,
  );
  const found = placed.filter((c) => matches([c.name], o.query));
  return [
    up,
    // Adding more, or taking them all off, is in here with them.
    ...(o.query.trim() ? [] : [{ type: 'contacts' } as Item]),
    ...byDistance(found, o.from).map(({ it, m }): Item => ({
      type: 'place',
      place: o.placeOfContact(it),
      contact: true,
      away: m,
    })),
  ];
}

/** An empty field: the lists of the user's own and the kinds of place, then the recent searches. */
export function blankItems(o: ListInput): Item[] {
  const placed = (o.contacts ?? []).filter((c) => c.lng !== undefined).length;
  return [
    ...(o.favourites.length
      ? [{ type: 'folder', folder: 'favourites', n: o.favourites.length } as Item]
      : []),
    // None placed yet: the row adds them, as there is no list to open.
    ...(o.contacts
      ? [
          placed
            ? ({ type: 'folder', folder: 'contacts', n: placed } as Item)
            : ({ type: 'contacts' } as Item),
        ]
      : []),
    ...(o.kinds ? [{ type: 'folder', folder: 'kinds', n: CATEGORY_IDS.length } as Item] : []),
    ...o.recent
      .filter((r) => o.kinds || 'place' in r)
      .map((recent): Item => ({ type: 'recent', recent })),
  ];
}
