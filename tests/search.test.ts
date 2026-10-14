import { describe, expect, it } from 'vitest';
import { parsePhoton, reverseUrl, searchUrl } from '../src/core/search';

const feature = (properties: object, coordinates = [13.405, 52.52]) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates },
  properties,
});

describe('searchUrl', () => {
  it('encodes the query and passes supported languages', () => {
    const url = new URL(searchUrl('  Café Einstein ', 'de'));
    expect(url.origin + url.pathname).toBe('https://photon.komoot.io/api/');
    expect(url.searchParams.get('q')).toBe('Café Einstein');
    expect(url.searchParams.get('lang')).toBe('de');
    expect(url.searchParams.get('lat')).toBeNull();
  });

  it('drops languages Photon does not support', () => {
    expect(new URL(searchUrl('x', 'pl')).searchParams.get('lang')).toBeNull();
  });

  it('biases towards the view with a clamped zoom', () => {
    const p = new URL(searchUrl('x', 'en', { lng: 13.4, lat: 52.5, zoom: 0.4 }, 3)).searchParams;
    expect(p.get('lat')).toBe('52.5000');
    expect(p.get('lon')).toBe('13.4000');
    expect(p.get('zoom')).toBe('2');
    expect(p.get('limit')).toBe('3');
  });

  it('builds reverse lookups', () => {
    const p = new URL(reverseUrl({ lng: 1, lat: 2 }, 'fr')).searchParams;
    expect(p.get('lat')).toBe('2.000000');
    expect(p.get('lang')).toBe('fr');
  });
});

describe('parsePhoton', () => {
  it('returns [] for garbage', () => {
    expect(parsePhoton(null)).toEqual([]);
    expect(parsePhoton({})).toEqual([]);
    expect(parsePhoton({ features: 'x' })).toEqual([]);
  });

  it('builds a name and a de-duplicated detail line', () => {
    const [p] = parsePhoton({
      features: [
        feature({
          name: 'Brandenburger Tor',
          street: 'Pariser Platz',
          district: 'Mitte',
          city: 'Berlin',
          state: 'Berlin',
          country: 'Deutschland',
        }),
      ],
    });
    expect(p).toEqual({
      name: 'Brandenburger Tor',
      detail: 'Pariser Platz, Mitte, Berlin, Deutschland',
      lng: 13.405,
      lat: 52.52,
    });
  });

  it('names addresses by street and number', () => {
    const [p] = parsePhoton({
      features: [feature({ street: 'Unter den Linden', housenumber: '5', city: 'Berlin' })],
    });
    expect(p.name).toBe('Unter den Linden 5');
    expect(p.detail).toBe('Berlin');
  });

  it('converts the extent to a west-south-east-north box', () => {
    const [p] = parsePhoton({
      features: [
        feature({ name: 'Berlin', country: 'Germany', extent: [13.08, 52.67, 13.76, 52.33] }),
      ],
    });
    expect(p.bbox).toEqual([13.08, 52.33, 13.76, 52.67]);
    expect(p.detail).toBe('Germany');
  });

  it('skips nameless or broken features and duplicates', () => {
    const places = parsePhoton({
      features: [
        feature({}),
        { properties: { name: 'No geometry' } },
        feature({ name: 'Bad' }, [Number.NaN, 1]),
        feature({ name: 'Twice' }),
        feature({ name: 'Twice' }, [13.4051, 52.5201]),
      ],
    });
    expect(places.map((p) => p.name)).toEqual(['Twice']);
  });

  it('keeps the OSM id for looking up details', () => {
    const [p] = parsePhoton({
      features: [
        {
          geometry: { coordinates: [13.4, 52.5] },
          properties: { name: 'Kiezmarkt', osm_type: 'N', osm_id: 42 },
        },
      ],
    });
    expect(p.osm).toBe('N42');
    const [q] = parsePhoton({
      features: [
        { geometry: { coordinates: [13.4, 52.5] }, properties: { name: 'X', osm_type: 'Q' } },
      ],
    });
    expect(q.osm).toBeUndefined();
  });
});
