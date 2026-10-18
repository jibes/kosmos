import { describe, expect, it } from 'vitest';
import {
  foundFor,
  foundOf,
  nearBest,
  categoriesFor,
  isCategoryWord,
  isOf,
  nearest,
  SHOWN_MAX,
} from '../src/core/categories';
import { TABLE } from '../src/core/categoryTable';
import { PLACE_WORDS } from '../src/core/placeWords';

describe('categories', () => {
  it('reads a kind of place from a query in either language', () => {
    expect(categoriesFor('Restaurant')).toEqual(['restaurant']);
    expect(categoriesFor('lebensmittel')).toEqual(['groceries']);
    expect(categoriesFor('Bäckerei')).toEqual(['bakery']);
    expect(categoriesFor('Café')[0]).toBe('cafe');
    expect(categoriesFor('Museum')).toEqual(['museum']);
    expect(categoriesFor('Museen')).toEqual(['museum']);
    expect(categoriesFor('Geldautomat')).toEqual(['atm']);
    expect(categoriesFor('Spielplatz')).toEqual(['playground']);
    expect(categoriesFor('Kino')).toEqual(['cinema']);
  });

  it('tells finer kinds apart', () => {
    expect(categoriesFor('Kita')).toEqual(['kindergarten']);
    expect(categoriesFor('Kindergarten')).toEqual(['kindergarten']);
    expect(categoriesFor('preschool')).toEqual(['kindergarten']);
    expect(categoriesFor('Elektronik')).toEqual(['electronics']);
    expect(categoriesFor('Baumarkt')).toEqual(['diy']);
    expect(categoriesFor('hardware store')).toEqual(['diy']);
    expect(categoriesFor('Schuhe')).toEqual(['shoes']);
    expect(categoriesFor('Kleidung')).toEqual(['clothes']);
    expect(categoriesFor('Briefkasten')).toEqual(['post_box']);
    expect(categoriesFor('Späti')).toEqual(['kiosk']);
    expect(categoriesFor('Zahnarzt')).toEqual(['dentist']);
    expect(categoriesFor('Tierarzt')).toEqual(['vet']);
    expect(categoriesFor('Drogerie')).toEqual(['chemist']);
    expect(categoriesFor('Friedhof')).toEqual(['cemetery']);
    // iD's presets add words the table does not name itself.
    expect(categoriesFor('Grundschule')).toEqual(['school']);
    expect(categoriesFor('pizza')).toEqual(['restaurant', 'fast_food']);
    expect(categoriesFor('mosque')).toEqual(['worship']);
  });

  it('finds stations and stops', () => {
    expect(categoriesFor('Bahnhof')).toEqual(['station']);
    expect(categoriesFor('U-Bahn')).toEqual(['station']);
    expect(categoriesFor('train station')).toEqual(['station']);
    // Every kind of stop at once, by the word for all of them.
    expect(categoriesFor('Haltestelle')).toEqual(['stops']);
    expect(categoriesFor('ÖPNV')).toEqual(['stops']);
    expect(categoriesFor('public transport')[0]).toBe('stops');
    expect(categoriesFor('Tramhaltestelle')).toEqual(['tram_stop']);
    expect(categoriesFor('S-Bahnhof')).toEqual(['station']);
    expect(isOf('stops', { name: 'Friedrichstraße', subclass: 'station' })).toBe(true);
    expect(isOf('stops', { name: 'Am Kupfergraben', subclass: 'tram_stop' })).toBe(true);
    expect(categoriesFor('Straßenbahn')).toEqual(['tram_stop']);
    expect(categoriesFor('Strassenbahn')).toEqual(['tram_stop']);
    expect(categoriesFor('Bushaltestelle')).toEqual(['bus_stop']);
    expect(isOf('station', { name: 'Friedrichstraße', subclass: 'station' })).toBe(true);
    expect(isOf('bus_stop', { name: 'Unter den Linden', subclass: 'bus_stop' })).toBe(true);
  });

  it('offers what a beginning may mean, exact words first, at most two', () => {
    expect(categoriesFor('Lebens')).toEqual(['groceries']);
    expect(categoriesFor('bar')[0]).toBe('bar');
    expect(categoriesFor('ba')).toEqual([]);
    expect(categoriesFor('kir')[0]).toBe('worship');
    expect(categoriesFor('ba', 5)).toEqual([]);
    expect(categoriesFor('sch', 5).length).toBeGreaterThan(1);
    expect(categoriesFor('sch').length).toBe(2);
  });

  it('reads plurals and inflections, and offers nothing a short word only begins', () => {
    expect(categoriesFor('Supermärkte')).toEqual(['groceries']);
    expect(categoriesFor('Kirchen')[0]).toBe('worship');
    expect(categoriesFor('Bäckereien')).toEqual(['bakery']);
    expect(categoriesFor('Krankenhäuser')).toEqual(['hospital']);
    expect(categoriesFor('Metzgerei')).toEqual(['butcher']);
    expect(categoriesFor('churches')[0]).toBe('worship');
    expect(categoriesFor('schools')).toEqual(['school']);
    expect(categoriesFor('hospitals')).toEqual(['hospital']);
    expect(categoriesFor('cinemas')).toEqual(['cinema']);
    expect(categoriesFor('ATMs')).toEqual(['atm']);
    expect(categoriesFor('petrol station')).toEqual(['fuel']);
    expect(categoriesFor('WC')).toEqual(['toilets']);
    // A park is green, then perhaps a place to park; a bar is not a barber.
    expect(categoriesFor('Park')).toEqual(['park', 'parking']);
    expect(categoriesFor('bar')).toEqual(['bar']);
    // A word as typed beats one its plural would strip to: a burger is no castle ("Burg").
    expect(categoriesFor('burger')[0]).toBe('fast_food');
  });

  it('leaves names to the place search', () => {
    for (const name of [
      'Brandenburger Tor',
      'Alexanderplatz',
      'Berlin',
      'Hamburg',
      'Tiergarten',
      'Wedding',
      'Hauptbahnhof',
      'MediaMarkt',
      'Lidl',
      'Charité',
      'Primark',
    ]) {
      expect(categoriesFor(name), name).toEqual([]);
    }
  });

  it('knows the words of each kind', () => {
    expect(isCategoryWord('Apotheke')).toBe(true);
    expect(isCategoryWord('Apotheke am Markt')).toBe(false);
    // Every generated word list belongs to a value the table uses: re-run `npm run words`.
    const tags = new Set<string>(Object.values(TABLE).flatMap((c) => c.tags));
    expect(Object.keys(PLACE_WORDS).filter((k) => !tags.has(k))).toEqual([]);
  });

  it('filters named places of the kind', () => {
    expect(isOf('chemist', { name: 'DM', subclass: 'chemist' })).toBe(true);
    expect(isOf('museum', { name: 'Galerie', subclass: 'gallery' })).toBe(true);
    expect(isOf('museum', { subclass: 'museum' })).toBe(false);
    // Toilets, cash machines and car parks rarely have a name: their kind is enough.
    expect(isOf('toilets', { subclass: 'toilets' })).toBe(true);
    expect(isOf('atm', { subclass: 'atm' })).toBe(true);
    expect(isOf('post_box', { subclass: 'post_box' })).toBe(true);
    expect(isOf('bank', { subclass: 'bank' })).toBe(false);
    expect(isOf('museum', { name: 'Kino', subclass: 'cinema' })).toBe(false);
    // A group holds what its finer kinds hold.
    expect(isOf('groceries', { name: 'Kamps', subclass: 'bakery' })).toBe(true);
    expect(isOf('bakery', { name: 'Kamps', subclass: 'bakery' })).toBe(true);
  });

  it('shows up to 60 of a kind, the nearest', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      name: `Café ${i}`,
      lng: 13.4 + i * 0.001,
      lat: 52.5,
    }));
    const list = nearest(many, { lng: 13.4, lat: 52.5 });
    expect(list).toHaveLength(SHOWN_MAX);
    expect(list.at(-1)!.name).toBe('Café 59');
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

describe('places found by name', () => {
  it('shows names found by the text, fitting the best and those near it', () => {
    expect(foundOf(foundFor('brandenburger'))).toBe('brandenburger');
    expect(foundOf('restaurant')).toBeNull();
    const at = (dx: number) => ({ lng: 13.4 + dx / 67800, lat: 52.5 });
    const places = [at(0), at(20_000), at(60_000), at(-29_000)];
    expect(nearBest(places)).toEqual([places[0], places[1], places[3]]);
  });
});
