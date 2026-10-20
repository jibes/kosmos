import { describe, expect, it } from 'vitest';
import {
  favouriteFeatures,
  FAVOURITES_MAX,
  isFavourite,
  mergeFavourites,
  parseFavourites,
  completeFavourite,
  renameFavourite,
  titleOf,
  toggleFavourite,
} from '../src/core/favourites';

const cafe = { name: 'Café Einstein', detail: 'Berlin', lng: 13.35, lat: 52.5 };

describe('favourites', () => {
  it('gets the address and id it lacked when starred too soon, nothing else changed', () => {
    const early = toggleFavourite(
      [],
      { name: 'Café Einstein', detail: '', lng: 13.4, lat: 52.5 },
      1,
    );
    const named = renameFavourite(early, early[0], 'Coffee');
    const [f] = completeFavourite(named, {
      name: 'Café Einstein',
      detail: 'Kurfürstenstraße 58',
      lng: 13.4,
      lat: 52.5,
      osm: 'N7',
    });
    expect(f).toMatchObject({ detail: 'Kurfürstenstraße 58', osm: 'N7', label: 'Coffee', at: 1 });
    // Already complete: the same list back.
    const again = completeFavourite([f], { ...f, detail: 'Elsewhere', osm: 'N8' });
    expect(again[0]).toBe(f);
  });

  it('stars and unstars a place, newest first', () => {
    let list = toggleFavourite([], cafe, 1);
    expect(list).toEqual([{ ...cafe, at: 1 }]);
    list = toggleFavourite(list, { name: 'Tor', detail: '', lng: 13.37, lat: 52.51 }, 2);
    expect(list.map((f) => f.name)).toEqual(['Tor', 'Café Einstein']);
    // The same place tapped again a few metres off: unstarred.
    list = toggleFavourite(list, { ...cafe, lng: cafe.lng + 0.0002 }, 3);
    expect(list.map((f) => f.name)).toEqual(['Tor']);
  });

  it('knows a place by its OSM id first, else its name and spot', () => {
    const list = toggleFavourite([], { ...cafe, osm: 'N1' }, 1);
    expect(isFavourite(list, { ...cafe, name: 'Einstein', osm: 'N1' })).toBe(true);
    expect(isFavourite(list, { ...cafe, osm: 'N2' })).toBe(false);
    expect(isFavourite(list, { ...cafe, lat: cafe.lat + 0.01 })).toBe(false);
  });

  it('keeps at most so many, the oldest dropped', () => {
    let list = toggleFavourite([], cafe, 0);
    for (let i = 1; i <= FAVOURITES_MAX; i++) {
      list = toggleFavourite(list, { ...cafe, name: `P${i}` }, i);
    }
    expect(list).toHaveLength(FAVOURITES_MAX);
    expect(list.at(-1)!.name).toBe('P1');
  });

  it('reads storage, dropping anything malformed', () => {
    const ok = { ...cafe, at: 1 };
    expect(parseFavourites(JSON.stringify([ok, { name: 'x' }, { ...ok, lat: 99 }]))).toEqual([ok]);
    expect(parseFavourites('{')).toEqual([]);
    expect(parseFavourites(null)).toEqual([]);
  });

  it('marks them on the map by name', () => {
    const f = favouriteFeatures([{ ...cafe, at: 1 }]).features[0];
    expect(f.geometry).toEqual({ type: 'Point', coordinates: [13.35, 52.5] });
    expect(f.properties).toEqual({ name: 'Café Einstein', fav: 0 });
  });

  it("takes the user's own name, and knows the place by either name", () => {
    let list = renameFavourite(toggleFavourite([], cafe, 1), cafe, '  Coffee  ');
    expect(list[0]).toMatchObject({ name: 'Café Einstein', label: 'Coffee' });
    expect(titleOf(list[0])).toBe('Coffee');
    expect(favouriteFeatures(list).features[0].properties!.name).toBe('Coffee');
    // Opened from the list it carries the new name; tapped on the map, the old one.
    expect(isFavourite(list, { ...cafe, name: 'Coffee' })).toBe(true);
    expect(isFavourite(list, cafe)).toBe(true);
    expect(toggleFavourite(list, { ...cafe, name: 'Coffee' }, 2)).toEqual([]);
    // Empty, or the place's own name, takes the name off again.
    list = renameFavourite(list, cafe, '');
    expect(list[0].label).toBeUndefined();
    expect(renameFavourite(list, cafe, 'Café Einstein')[0].label).toBeUndefined();
    expect(parseFavourites(JSON.stringify([{ ...cafe, at: 1, label: 3 }]))).toEqual([]);
  });

  it('adds favourites from a backup, the same place kept as it is here', () => {
    const here = renameFavourite(toggleFavourite([], cafe, 5), cafe, 'Coffee');
    const tor = { name: 'Tor', detail: '', lng: 13.37, lat: 52.51, at: 9 };
    const merged = mergeFavourites(here, [{ ...cafe, at: 1 }, tor]);
    expect(merged.map(titleOf)).toEqual(['Tor', 'Coffee']);
  });
});
