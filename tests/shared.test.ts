import { describe, expect, it } from 'vitest';
import { parseShared, degreesIn } from '../src/core/shared';

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
    // The place itself, not where Google's camera stood beside its panel.
    expect(
      parseShared(
        'https://www.google.com/maps/place/Brandenburger+Tor/@52.5161,13.3712,16z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d52.5162746!4d13.3777041!16s',
      ),
    ).toEqual({
      at: { lat: 52.5162746, lng: 13.3777041 },
      zoom: 16,
      name: 'Brandenburger Tor',
    });
    // An OpenStreetMap object's page: the object, by its id.
    expect(parseShared('https://www.openstreetmap.org/node/518071791')).toEqual({
      osm: 'N518071791',
    });
    expect(parseShared('https://www.openstreetmap.org/way/4067/history')).toEqual({ osm: 'W4067' });
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

describe('degreesIn', () => {
  const near = (p: { lat: number; lng: number } | null, lat: number, lng: number) => {
    expect(p).not.toBeNull();
    expect(p!.lat).toBeCloseTo(lat, 4);
    expect(p!.lng).toBeCloseTo(lng, 4);
  };
  it('reads degrees, minutes and seconds', () => {
    near(degreesIn(`52°30'58.7"N 13°22'39.7"E`), 52.516306, 13.377694);
    near(degreesIn(`52° 30′ 58.7″ N, 13° 22′ 39.7″ E`), 52.516306, 13.377694);
  });
  it('reads degrees and decimal minutes, letters first', () => {
    near(degreesIn(`N 52° 30.978' E 013° 22.662'`), 52.5163, 13.3777);
  });
  it('takes south, west and the German O for east', () => {
    near(degreesIn(`33°51'35"S 151°12'40"E`), -33.859722, 151.211111);
    near(degreesIn(`53°20'N 6°15'W`), 53.333333, -6.25);
    near(degreesIn(`52,5163° N 13,3777° O`), 52.5163, 13.3777);
  });
  it('puts them in order by their letters', () => {
    near(degreesIn(`13°22'39.7"E 52°30'58.7"N`), 52.516306, 13.377694);
  });
  it('reads decimal degrees with hemisphere letters', () => {
    near(degreesIn('52.5163N 13.3777E'), 52.5163, 13.3777);
    near(degreesIn('34.0522 N, 118.2437 W'), 34.0522, -118.2437);
  });
  it('refuses what is not a point', () => {
    expect(degreesIn(`52°75'N 13°E`)).toBeNull();
    expect(degreesIn(`52°N 13°N`)).toBeNull();
    expect(degreesIn('Hauptstraße 52')).toBeNull();
    expect(degreesIn(`95°N 13°E`)).toBeNull();
  });
  it('is a point when shared or typed', () => {
    expect(parseShared(`52°30'58.7"N 13°22'39.7"E`)).toMatchObject({
      at: { lat: expect.closeTo(52.5163, 3) },
    });
  });
});
