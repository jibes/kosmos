import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS, type Category } from '../src/core/categories';
import type { Contact } from '../src/core/contacts';
import type { Favourite } from '../src/core/favourites';
import type { Recent } from '../src/core/recent';
import type { Place } from '../src/core/search';
import {
  COMMON,
  blankItems,
  byDistance,
  folderItems,
  kindsInOrder,
  matchFavourites,
  matches,
  type ListInput,
} from '../src/core/searchList';

const O = { lng: 13.4, lat: 52.5 };
/** A point `km` kilometres north of O. */
const north = (km: number) => ({ lng: O.lng, lat: O.lat + km / 111.2 });
const fav = (name: string, km: number, label?: string): Favourite => ({
  name,
  detail: '',
  ...north(km),
  at: 0,
  ...(label ? { label } : {}),
});
const contact = (name: string, km?: number): Contact => ({
  name,
  address: `${name} Street 1`,
  ...(km === undefined ? {} : north(km)),
});
const place = (p: { name: string; lng: number; lat: number }): Place => ({
  name: p.name,
  detail: '',
  lng: p.lng,
  lat: p.lat,
});
const recentPlace: Recent = { place: { name: 'Zoo', detail: '', lng: 13.3, lat: 52.5 }, at: 0 };
const recentKind: Recent = { kind: 'cafe', label: 'Cafés', at: 0 };

const input = (o: Partial<ListInput> = {}): ListInput => ({
  query: '',
  folder: null,
  favourites: [fav('Far', 9), fav('Bakery Müller', 1, 'Mum'), fav('Near', 0.2)],
  contacts: [contact('Anna Berg', 3), contact('Ben', 0.5), contact('Unplaced')],
  recent: [recentPlace, recentKind],
  kinds: true,
  labelOf: (c: Category) => c,
  placeOf: (f) => place({ ...f, name: f.label ?? f.name }),
  placeOfContact: (c) => place({ name: c.name, lng: c.lng ?? 0, lat: c.lat ?? 0 }),
  from: O,
  ...o,
});

describe('search list', () => {
  it('an empty field: a row per list, then the recent searches, never all favourites', () => {
    const items = blankItems(input());
    expect(items.map((i) => i.type)).toEqual(['folder', 'folder', 'folder', 'recent', 'recent']);
    expect(items[0]).toEqual({ type: 'folder', folder: 'favourites', n: 3 });
    // Only placed contacts count.
    expect(items[1]).toEqual({ type: 'folder', folder: 'contacts', n: 2 });
    expect(items[2]).toMatchObject({ type: 'folder', folder: 'kinds' });
  });

  it('leaves out what is not there, and kinds where they cannot be searched', () => {
    const items = blankItems(
      input({ favourites: [], contacts: [contact('Unplaced')], kinds: false }),
    );
    // No contact placed yet: the row adds them, there is no list to open.
    expect(items.map((i) => i.type)).toEqual(['contacts', 'recent']);
    // A route's end: places only, no contacts row.
    expect(blankItems(input({ contacts: undefined, kinds: false })).map((i) => i.type)).toEqual([
      'folder',
      'recent',
    ]);
  });

  it('opens favourites nearest first, with how far, filtered by either name', () => {
    const items = folderItems({ ...input(), folder: 'favourites' });
    expect(items[0]).toEqual({ type: 'up', folder: 'favourites' });
    const names = items.slice(1).map((i) => (i.type === 'place' ? i.place.name : ''));
    expect(names).toEqual(['Near', 'Mum', 'Far']);
    const away = items[1].type === 'place' ? items[1].away! : 0;
    expect(away).toBeGreaterThan(150);
    expect(away).toBeLessThan(250);
    // The user's own name or the place's: both find it.
    for (const q of ['mum', 'müll', 'bak']) {
      const found = folderItems({ ...input({ query: q }), folder: 'favourites' });
      expect(found.map((i) => (i.type === 'place' ? i.place.name : i.type))).toEqual(['up', 'Mum']);
    }
  });

  it('opens contacts: adding first, then the placed ones nearest first', () => {
    const items = folderItems({ ...input(), folder: 'contacts' });
    expect(items.map((i) => (i.type === 'place' ? i.place.name : i.type))).toEqual([
      'up',
      'contacts',
      'Ben',
      'Anna Berg',
    ]);
    // Typing finds by a word of the name; the adding row steps aside.
    const typed = folderItems({ ...input({ query: 'berg' }), folder: 'contacts' });
    expect(typed.map((i) => (i.type === 'place' ? i.place.name : i.type))).toEqual([
      'up',
      'Anna Berg',
    ]);
  });

  it('opens every kind of place, the common ones first', () => {
    const items = folderItems({ ...input(), folder: 'kinds' });
    expect(items).toHaveLength(CATEGORY_IDS.length + 1);
    expect(items.slice(1, 1 + COMMON.length).map((i) => (i.type === 'cat' ? i.cat : ''))).toEqual(
      COMMON,
    );
    const rest = kindsInOrder((c) => c).slice(COMMON.length);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
    expect(folderItems({ ...input({ query: 'pha' }), folder: 'kinds' })).toEqual([
      { type: 'up', folder: 'kinds' },
      { type: 'cat', cat: 'pharmacy' },
    ]);
  });

  it('finds favourites by name when typed', () => {
    const list = input().favourites;
    expect(matchFavourites(list, 'm').map((f) => f.name)).toEqual([]);
    expect(matchFavourites(list, 'mu').map((f) => f.name)).toEqual(['Bakery Müller']);
    expect(matchFavourites(list, 'nea').map((f) => f.name)).toEqual(['Near']);
    expect(matches(['Café am Markt'], 'mark')).toBe(true);
    expect(matches(['Café am Markt'], 'arkt')).toBe(false);
  });

  it('keeps the order without a place to count from', () => {
    const list = [north(5), north(1)];
    expect(byDistance(list).map(({ it }) => it)).toEqual(list);
    expect(byDistance(list, O).map(({ it }) => it)).toEqual([north(1), north(5)]);
  });
});
