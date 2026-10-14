import { describe, expect, it } from 'vitest';
import { categoryFor, nearest, poiFilter } from '../src/core/categories';

describe('categories', () => {
  it('reads a category from a query in either language', () => {
    expect(categoryFor('Restaurant')).toBe('restaurant');
    expect(categoryFor('lebensmittel')).toBe('groceries');
    expect(categoryFor('Lebens')).toBe('groceries');
    expect(categoryFor('Bäckerei')).toBe('groceries');
    expect(categoryFor('Café')).toBe('cafe');
    expect(categoryFor('apotheke')).toBe('pharmacy');
    expect(categoryFor('Tankstelle')).toBe('fuel');
  });

  it('leaves names and short fragments to the place search', () => {
    expect(categoryFor('Brandenburger Tor')).toBeNull();
    expect(categoryFor('re')).toBeNull();
    // Three letters only match a whole word.
    expect(categoryFor('bar')).toBe('bar');
    expect(categoryFor('res')).toBeNull();
  });

  it('filters named places of the category', () => {
    expect(JSON.stringify(poiFilter('pharmacy'))).toContain('"chemist"');
  });

  it('lists the nearest first, each place once', () => {
    const at = (name: string, dx: number) => ({ name, lng: 13.4 + dx / 67800, lat: 52.5 });
    const list = nearest(
      [at('Far', 900), at('Near', 100), at('Near', 100), at('Mid', 400)],
      at('', 0),
    );
    expect(list.map((p) => p.name)).toEqual(['Near', 'Mid', 'Far']);
    expect(list[0].m).toBeCloseTo(100, -1);
    expect(nearest([at('A', 1), at('B', 2)], at('', 0), 1)).toHaveLength(1);
  });
});
