import { describe, expect, it } from 'vitest';
import {
  isOsmId,
  lookupUrl,
  nominatimSearchUrl,
  parseLookup,
  parseNominatim,
  withScheme,
} from '../src/core/details';

describe('details', () => {
  it('looks a place up by its OSM id with its extra tags', () => {
    const url = new URL(lookupUrl('N123', 'de'));
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/lookup');
    expect(url.searchParams.get('osm_ids')).toBe('N123');
    expect(url.searchParams.get('extratags')).toBe('1');
    expect(url.searchParams.get('accept-language')).toBe('de');
    expect(isOsmId('W42')).toBe(true);
    expect(isOsmId('X42')).toBe(false);
  });

  it('reads hours, phone and website, the first of several', () => {
    expect(
      parseLookup([
        {
          extratags: {
            opening_hours: 'Mo-Fr 09:00-18:00',
            'contact:phone': '+49 30 123; +49 30 456',
            website: 'example.org/shop',
          },
        },
      ]),
    ).toEqual({ hours: 'Mo-Fr 09:00-18:00', phone: '+49 30 123', website: 'example.org/shop' });
    expect(withScheme('example.org')).toBe('https://example.org');
    expect(withScheme('http://example.org')).toBe('http://example.org');
  });

  it('gives nothing for nothing, and drops a website that is not one', () => {
    expect(parseLookup([])).toEqual({});
    expect(parseLookup(null)).toEqual({});
    expect(parseLookup([{ extratags: null }])).toEqual({});
    expect(parseLookup([{ extratags: { website: 'javascript:alert(1)' } }])).toEqual({});
  });
});

describe('Nominatim search', () => {
  it('asks once for a settled query, preferring the view', () => {
    const url = new URL(
      nominatimSearchUrl(' Pariser Platz ', 'de', { lng: 13.4, lat: 52.5, zoom: 13 }),
    );
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('Pariser Platz');
    expect(url.searchParams.get('viewbox')!.split(',')).toHaveLength(4);
    expect(url.searchParams.has('bounded')).toBe(false);
  });

  it('reads places with name, address, OSM id and extent', () => {
    const [p] = parseNominatim([
      {
        name: 'Brandenburger Tor',
        display_name: 'Brandenburger Tor, Pariser Platz, Mitte, Berlin, 10117, Deutschland',
        lat: '52.5163',
        lon: '13.3777',
        osm_type: 'way',
        osm_id: 518071791,
        boundingbox: ['52.516', '52.517', '13.377', '13.378'],
      },
    ]);
    expect(p).toEqual({
      name: 'Brandenburger Tor',
      detail: 'Pariser Platz, Mitte, Berlin, 10117',
      lng: 13.3777,
      lat: 52.5163,
      osm: 'W518071791',
      bbox: [13.377, 52.516, 13.378, 52.517],
    });
    expect(
      parseNominatim([{ display_name: 'Unter den Linden, Berlin', lat: '1', lon: '2' }])[0].name,
    ).toBe('Unter den Linden');
    expect(parseNominatim(null)).toEqual([]);
  });
});
