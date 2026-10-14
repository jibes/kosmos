import { describe, expect, it } from 'vitest';
import { isOsmId, lookupUrl, parseLookup, withScheme } from '../src/core/details';

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
