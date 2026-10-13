import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, parseView, serializeView } from '../src/core/view';

describe('view', () => {
  it('round-trips with rounding', () => {
    const v = { lng: 13.4050001234, lat: 52.52, zoom: 12.3456, bearing: 33.33, pitch: 45.06 };
    expect(parseView(serializeView(v))).toEqual({
      lng: 13.405,
      lat: 52.52,
      zoom: 12.35,
      bearing: 33.3,
      pitch: 45.1,
    });
  });

  it('defaults bearing and pitch', () => {
    expect(parseView('{"lng":1,"lat":2,"zoom":3}')).toEqual({
      lng: 1,
      lat: 2,
      zoom: 3,
      bearing: 0,
      pitch: 0,
    });
  });

  it.each([
    null,
    '',
    'nope',
    'null',
    '[]',
    '{"lng":1,"lat":2}',
    '{"lng":"1","lat":2,"zoom":3}',
    '{"lng":1,"lat":91,"zoom":3}',
    '{"lng":181,"lat":0,"zoom":3}',
    '{"lng":1,"lat":2,"zoom":30}',
    '{"lng":1,"lat":2,"zoom":3,"pitch":90}',
  ])('rejects %s', (raw) => {
    expect(parseView(raw)).toBeNull();
  });

  it('has a sane default', () => {
    expect(parseView(serializeView(DEFAULT_VIEW))).toEqual(DEFAULT_VIEW);
  });
});
