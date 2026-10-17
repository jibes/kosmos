import { describe, expect, it } from 'vitest';
import { forget, fresh, parseRecent, remember, RECENT_MAX, type Recent } from '../src/core/recent';

const DAY = 86_400_000;
const place = (name: string, dx = 0, at = 0): Recent => ({
  place: { name, detail: '', lng: 13.4 + dx / 67800, lat: 52.5 },
  at,
});

describe('recent searches', () => {
  it('puts the newest first, each once', () => {
    let list: Recent[] = [];
    list = remember(list, place('A', 0, 1), 1);
    list = remember(list, place('B', 0, 2), 2);
    list = remember(list, place('A', 20, 3), 3);
    expect(list.map((r) => ('place' in r ? r.place.name : r.kind))).toEqual(['A', 'B']);
    // Another branch of the same name elsewhere is another place.
    list = remember(list, place('A', 2000, 4), 4);
    expect(list).toHaveLength(3);
  });

  it('keeps kinds of place by kind', () => {
    let list: Recent[] = [];
    list = remember(list, { kind: 'restaurant', label: 'Restaurants', at: 1 }, 1);
    list = remember(list, { kind: 'restaurant', label: 'Restaurants', at: 2 }, 2);
    expect(list).toHaveLength(1);
  });

  it('keeps a few, and not for ever', () => {
    let list: Recent[] = [];
    for (let i = 0; i < 12; i++) list = remember(list, place(`P${i}`, 0, i), i);
    expect(list).toHaveLength(RECENT_MAX);
    expect(fresh([place('old', 0, 0)], 31 * DAY)).toEqual([]);
    expect(fresh([place('new', 0, 0)], 29 * DAY)).toHaveLength(1);
  });

  it('forgets one on request', () => {
    const list = [place('A', 0, 2), place('B', 0, 1)];
    expect(forget(list, list[0])).toEqual([list[1]]);
  });

  it('reads what storage holds, dropping anything malformed', () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('{')).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    const ok = place('A', 0, 5);
    expect(
      parseRecent(JSON.stringify([ok, { place: { name: 'x' }, at: 1 }, { kind: 3, at: 1 }])),
    ).toEqual([ok]);
    // A kind an update renamed or dropped is forgotten; a chain or a search by name stays.
    const kinds = [
      { kind: 'cafe', label: 'Cafés', at: 3 },
      { kind: 'cat_gone', label: 'Old', at: 2 },
      { kind: 'name:Rewe', label: 'Rewe', at: 1 },
    ];
    expect(parseRecent(JSON.stringify(kinds)).map((r) => ('kind' in r ? r.kind : ''))).toEqual([
      'cafe',
      'name:Rewe',
    ]);
  });
});
