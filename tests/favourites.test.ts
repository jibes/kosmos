import { describe, expect, it } from 'vitest';
import {
  favouriteFeatures,
  FAVOURITES_MAX,
  isFavourite,
  parseFavourites,
  toggleFavourite,
} from '../src/core/favourites';

const cafe = { name: 'Café Einstein', detail: 'Berlin', lng: 13.35, lat: 52.5 };

describe('favourites', () => {
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
});
