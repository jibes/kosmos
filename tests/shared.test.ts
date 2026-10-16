import { describe, expect, it } from 'vitest';
import { parseShared } from '../src/core/shared';

describe('shared links', () => {
  it('reads geo: links', () => {
    expect(parseShared('geo:52.5163,13.3777')).toEqual({ at: { lat: 52.5163, lng: 13.3777 } });
    expect(parseShared('geo:52.5163,13.3777;u=10?z=17')).toEqual({
      at: { lat: 52.5163, lng: 13.3777 },
      zoom: 17,
    });
    expect(parseShared('geo:0,0?q=52.52,13.40(Brandenburger Tor)')).toEqual({
      at: { lat: 52.52, lng: 13.4 },
      name: 'Brandenburger Tor',
    });
    expect(parseShared('geo:0,0?q=Pariser+Platz+1,+Berlin')).toEqual({
      query: 'Pariser Platz 1, Berlin',
    });
  });

  it('reads map links with a point in them', () => {
    expect(
      parseShared(
        'https://www.openstreetmap.org/?mlat=52.5163&mlon=13.3777#map=17/52.5163/13.3777',
      ),
    ).toEqual({ at: { lat: 52.5163, lng: 13.3777 }, zoom: 17 });
    expect(parseShared('https://www.openstreetmap.org/#map=15/52.52/13.40')).toEqual({
      at: { lat: 52.52, lng: 13.4 },
      zoom: 15,
    });
    expect(
      parseShared(
        'https://www.google.com/maps/place/Brandenburger+Tor/@52.5163,13.3777,17z/data=x',
      ),
    ).toEqual({ at: { lat: 52.5163, lng: 13.3777 }, zoom: 17, name: 'Brandenburger Tor' });
    expect(parseShared('https://maps.google.com/?q=52.5163,13.3777')).toEqual({
      at: { lat: 52.5163, lng: 13.3777 },
    });
    expect(parseShared('https://maps.apple.com/?ll=52.5163,13.3777&q=Tor')).toEqual({
      at: { lat: 52.5163, lng: 13.3777 },
      name: 'Tor',
    });
  });

  it('searches the words of a message whose link holds no point', () => {
    // Google's share: name, address and a short link that only Google can open.
    expect(
      parseShared(
        'Café Einstein, Kurfürstenstraße 58, 10785 Berlin https://maps.app.goo.gl/AbC123',
      ),
    ).toEqual({ query: 'Café Einstein, Kurfürstenstraße 58, 10785 Berlin' });
  });

  it('reads plain coordinates, and leaves nonsense alone', () => {
    expect(parseShared('52.5163, 13.3777')).toEqual({ at: { lat: 52.5163, lng: 13.3777 } });
    expect(parseShared('Hauptstraße 12, 10827 Berlin')).toEqual({
      query: 'Hauptstraße 12, 10827 Berlin',
    });
    expect(parseShared('geo:0,0')).toBeNull();
    expect(parseShared('  ')).toBeNull();
    expect(parseShared('geo:95,13')).toBeNull();
  });
});
