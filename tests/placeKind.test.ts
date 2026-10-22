import { describe, expect, it } from 'vitest';
import { kindOfOsm, kindOfPoi } from '../src/core/placeKind';

describe('kind of place', () => {
  it('tells stations and stops by their OSM tags', () => {
    expect(kindOfOsm('railway', 'station')).toBe('train');
    expect(kindOfOsm('public_transport', 'station')).toBe('train');
    expect(kindOfOsm('railway', 'tram_stop')).toBe('tram');
    expect(kindOfOsm('highway', 'bus_stop')).toBe('bus');
    expect(kindOfOsm('public_transport', 'platform')).toBe('bus');
    expect(kindOfOsm('railway', 'subway_entrance')).toBe('subway');
    expect(kindOfOsm('aeroway', 'aerodrome')).toBe('plane');
    // Search rows show what the map shows: fuel, a cash machine, a pitch.
    expect(kindOfOsm('amenity', 'fuel')).toBe('fuel');
    expect(kindOfOsm('amenity', 'atm')).toBe('money');
    expect(kindOfOsm('leisure', 'pitch')).toBe('sport');
    expect(kindOfOsm('shop', 'bicycle')).toBe('shop');
    expect(kindOfPoi({ class: 'bicycle', subclass: 'bicycle' })).toBe('bike');
    expect(kindOfPoi({ class: 'bakery', subclass: 'bakery' })).toBe('shop');
    // A nameless toilet or tap among category results: its own icon, not a pin.
    expect(kindOfPoi({ class: 'toilets', subclass: 'toilets' })).toBe('toilets');
    expect(kindOfPoi({ class: 'drinking_water', subclass: 'drinking_water' })).toBe('water');
    expect(kindOfOsm('amenity', 'recycling')).toBe('recycling');
  });

  it('tells other kinds, streets, towns and addresses', () => {
    expect(kindOfOsm('amenity', 'restaurant')).toBe('food');
    expect(kindOfOsm('amenity', 'cafe')).toBe('cafe');
    expect(kindOfOsm('shop', 'electronics')).toBe('shop');
    expect(kindOfOsm('tourism', 'hotel')).toBe('stay');
    expect(kindOfOsm('tourism', 'museum')).toBe('culture');
    expect(kindOfOsm('historic', 'memorial')).toBe('culture');
    expect(kindOfOsm('highway', 'residential', 'street')).toBe('street');
    expect(kindOfOsm('place', 'city', 'city')).toBe('town');
    expect(kindOfOsm('boundary', 'administrative', 'city')).toBe('town');
    expect(kindOfOsm('building', 'yes', 'house')).toBe('address');
    expect(kindOfOsm('man_made', 'tower', 'other')).toBe('place');
    expect(kindOfOsm()).toBe('place');
  });

  it('reads the map tiles the same way', () => {
    expect(kindOfPoi({ class: 'railway', subclass: 'station' })).toBe('train');
    expect(kindOfPoi({ class: 'bus', subclass: 'bus_stop' })).toBe('bus');
    expect(kindOfPoi({ class: 'shop', subclass: 'electronics' })).toBe('shop');
    expect(kindOfPoi({ class: 'cafe', subclass: 'cafe' })).toBe('cafe');
    expect(kindOfPoi({ class: 'office', subclass: 'company' })).toBe('place');
  });
});
