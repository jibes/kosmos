import { describe, expect, it } from 'vitest';
import {
  directionsUrl,
  distance,
  formatLngLat,
  geoUri,
  metersPerPixel,
  osmUrl,
  plainLngLat,
  wrapLng,
} from '../src/core/geo';

describe('geo', () => {
  it('metres per pixel halves with each zoom level and shrinks towards the poles', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78271.5, 0);
    expect(metersPerPixel(0, 1)).toBeCloseTo(metersPerPixel(0, 0) / 2, 6);
    expect(metersPerPixel(60, 10)).toBeCloseTo(metersPerPixel(0, 10) / 2, 6);
  });

  it('formats hemispheres', () => {
    expect(formatLngLat({ lng: 13.405, lat: 52.52 })).toBe('52.52000° N, 13.40500° E');
    expect(formatLngLat({ lng: -43.2, lat: -22.9 }, 1)).toBe('22.9° S, 43.2° W');
    expect(plainLngLat({ lng: 13.405, lat: 52.52 })).toBe('52.520000, 13.405000');
  });

  it('wraps longitudes', () => {
    expect(wrapLng(190)).toBe(-170);
    expect(wrapLng(-190)).toBe(170);
    expect(wrapLng(180)).toBe(-180);
    expect(wrapLng(12)).toBe(12);
  });

  it('builds links for other apps', () => {
    const p = { lng: 13.405, lat: 52.52 };
    expect(osmUrl(p, 16)).toBe(
      'https://www.openstreetmap.org/?mlat=52.520000&mlon=13.405000#map=16/52.520000/13.405000',
    );
    expect(geoUri(p, 'Café & Bar')).toBe(
      'geo:52.520000,13.405000?q=52.520000,13.405000(Caf%C3%A9%20%26%20Bar)',
    );
    expect(geoUri(p)).toBe('geo:52.520000,13.405000?q=52.520000,13.405000');
    expect(directionsUrl(p)).toContain('route=%3B52.520000%2C13.405000');
  });

  it('measures great-circle distance', () => {
    const berlin = { lng: 13.405, lat: 52.52 };
    const paris = { lng: 2.3522, lat: 48.8566 };
    expect(distance(berlin, paris) / 1000).toBeCloseTo(877.5, 0);
    expect(distance(berlin, berlin)).toBe(0);
  });
});
