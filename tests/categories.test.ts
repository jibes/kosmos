import { describe, expect, it } from 'vitest';
import { categoriesFor, isOf, nearest } from '../src/core/categories';

describe('categories', () => {
  it('reads a kind of place from a query in either language', () => {
    expect(categoriesFor('Restaurant')).toEqual(['restaurant']);
    expect(categoriesFor('lebensmittel')).toEqual(['groceries']);
    expect(categoriesFor('Bäckerei')).toEqual(['groceries']);
    expect(categoriesFor('Café')).toEqual(['cafe']);
    expect(categoriesFor('Museum')).toEqual(['museum']);
    expect(categoriesFor('Museen')).toEqual(['museum']);
    expect(categoriesFor('Geldautomat')).toEqual(['bank']);
    expect(categoriesFor('Spielplatz')).toEqual(['playground']);
    expect(categoriesFor('Kino')).toEqual(['theatre']);
  });

  it('offers what a beginning may mean, exact words first, at most two', () => {
    expect(categoriesFor('Lebens')).toEqual(['groceries']);
    expect(categoriesFor('bar')[0]).toBe('bar');
    expect(categoriesFor('ba')).toEqual([]);
    expect(categoriesFor('kir')).toEqual(['worship']);
    expect(categoriesFor('ba', 5)).toEqual([]);
    expect(categoriesFor('bank', 5)).toEqual(['bank']);
    expect(categoriesFor('sch', 5).length).toBeGreaterThan(1);
    expect(categoriesFor('sch').length).toBe(2);
  });

  it('reads plurals and inflections, and offers nothing a short word only begins', () => {
    expect(categoriesFor('Supermärkte')).toEqual(['groceries']);
    expect(categoriesFor('Kirchen')).toEqual(['worship']);
    expect(categoriesFor('Bäckereien')).toEqual(['groceries']);
    expect(categoriesFor('Krankenhäuser')).toEqual(['doctor']);
    expect(categoriesFor('Metzgerei')).toEqual(['groceries']);
    expect(categoriesFor('churches')).toEqual(['worship']);
    expect(categoriesFor('schools')).toEqual(['school']);
    expect(categoriesFor('hospitals')).toEqual(['doctor']);
    expect(categoriesFor('cinemas')).toEqual(['theatre']);
    expect(categoriesFor('ATMs')).toEqual(['bank']);
    expect(categoriesFor('petrol station')).toEqual(['fuel']);
    expect(categoriesFor('WC')).toEqual(['toilets']);
    // A park is green, then perhaps a place to park; a bar is not a barber.
    expect(categoriesFor('Park')).toEqual(['park', 'parking']);
    expect(categoriesFor('bar')).toEqual(['bar']);
  });

  it('leaves names to the place search', () => {
    expect(categoriesFor('Brandenburger Tor')).toEqual([]);
    expect(categoriesFor('Alexanderplatz')).toEqual([]);
  });

  it('filters named places of the kind', () => {
    expect(isOf('pharmacy', { name: 'DM', subclass: 'chemist' })).toBe(true);
    expect(isOf('museum', { name: 'Galerie', subclass: 'gallery' })).toBe(true);
    expect(isOf('museum', { subclass: 'museum' })).toBe(false);
    // Toilets, cash machines and car parks rarely have a name: their kind is enough.
    expect(isOf('toilets', { subclass: 'toilets' })).toBe(true);
    expect(isOf('bank', { subclass: 'atm' })).toBe(true);
    expect(isOf('bank', { subclass: 'bank' })).toBe(false);
    expect(isOf('museum', { name: 'Kino', subclass: 'cinema' })).toBe(false);
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
