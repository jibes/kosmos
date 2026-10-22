import { describe, expect, it } from 'vitest';
import { expression } from '@maplibre/maplibre-gl-style-spec';
import { palettes } from '../src/core/palette';
import { poiIcon } from '../src/core/stylePoi';
import { POI_GROUP, type PlaceKind } from '../src/core/placeKind';
import { glyphOf } from '../src/ui/icons';

const icon = poiIcon(palettes.light);
const evaluate = (expr: unknown, properties: Record<string, unknown>) => {
  const e = expression.createExpression(expr, 'layers[0].layout.icon-image');
  if (e.result !== 'success') throw new Error(JSON.stringify(e.value));
  return e.value.evaluate({ zoom: 15 }, { type: 'Point', properties } as never);
};

describe("the map's places' icons", () => {
  it('picks the icon by the kind of place, none for an unknown one', () => {
    const img = icon.layout['icon-image'];
    expect(evaluate(img, { class: 'cafe', subclass: 'cafe' })).toBe('poi-cafe');
    expect(evaluate(img, { class: 'railway', subclass: 'station' })).toBe('poi-train');
    expect(evaluate(img, { class: 'shop', subclass: 'bakery' })).toBe('poi-shop');
    expect(evaluate(img, { class: 'office', subclass: 'company' })).toBe('');
    // A shop the tiles give a class of its own is a shop all the same.
    expect(evaluate(img, { class: 'bakery', subclass: 'bakery' })).toBe('poi-shop');
    expect(evaluate(img, { class: 'alcohol_shop', subclass: 'wine' })).toBe('poi-shop');
    expect(evaluate(img, { class: 'hairdresser', subclass: 'hairdresser' })).toBe('poi-shop');
    // What a driver, a cyclist or anyone out looks for.
    expect(evaluate(img, { class: 'fuel', subclass: 'fuel' })).toBe('poi-fuel');
    expect(evaluate(img, { class: 'charging_station', subclass: 'charging_station' })).toBe(
      'poi-charging',
    );
    expect(evaluate(img, { class: 'parking', subclass: 'parking' })).toBe('poi-parking');
    expect(evaluate(img, { class: 'car', subclass: 'car_repair' })).toBe('poi-car');
    expect(evaluate(img, { class: 'bicycle', subclass: 'bicycle_rental' })).toBe('poi-bike');
    expect(evaluate(img, { class: 'bank', subclass: 'bank' })).toBe('poi-money');
    expect(evaluate(img, { class: 'atm', subclass: 'atm' })).toBe('poi-money');
    expect(evaluate(img, { class: 'post', subclass: 'post_office' })).toBe('poi-post');
    expect(evaluate(img, { class: 'police', subclass: 'police' })).toBe('poi-police');
    expect(evaluate(img, { class: 'stadium', subclass: 'stadium' })).toBe('poi-sport');
    expect(evaluate(img, { class: 'swimming', subclass: 'swimming_pool' })).toBe('poi-sport');
    expect(evaluate(img, { class: 'town_hall', subclass: 'townhall' })).toBe('poi-civic');
    expect(evaluate(img, { class: 'attraction', subclass: 'viewpoint' })).toBe('poi-view');
    expect(evaluate(img, { class: 'campsite', subclass: 'camp_site' })).toBe('poi-camp');
    expect(evaluate(img, { class: 'theatre', subclass: 'theatre' })).toBe('poi-theatre');
    expect(evaluate(img, { class: 'lodging', subclass: 'bed_and_breakfast' })).toBe('poi-stay');
    expect(evaluate(img, { class: 'fire_station', subclass: 'fire_station' })).toBe('poi-fire');
    expect(evaluate(img, { class: 'information', subclass: 'information' })).toBe('poi-info');
    expect(evaluate(img, { class: 'cemetery', subclass: 'grave_yard' })).toBe('poi-cemetery');
    expect(evaluate(img, { class: 'cinema', subclass: 'cinema' })).toBe('poi-cinema');
    expect(evaluate(img, { class: 'library', subclass: 'library' })).toBe('poi-library');
    expect(evaluate(img, { class: 'toilets', subclass: 'toilets' })).toBe('poi-toilets');
    // The tiles put a place of worship's faith, an information point's sort and a pitch's sport
    // where the subclass would be: their class says what they are.
    const worship = (subclass?: string) =>
      evaluate(img, { class: 'place_of_worship', ...(subclass ? { subclass } : {}) });
    expect(worship('christian')).toBe('poi-church');
    expect(worship('muslim')).toBe('poi-mosque');
    expect(worship('jewish')).toBe('poi-synagogue');
    expect(worship('buddhist')).toBe('poi-culture');
    expect(worship()).toBe('poi-culture');
    expect(evaluate(img, { class: 'information', subclass: 'office' })).toBe('poi-info');
    expect(evaluate(img, { class: 'pitch', subclass: 'soccer' })).toBe('poi-sport');
    // A cable car's station is no train station.
    expect(evaluate(img, { class: 'aerialway', subclass: 'station' })).toBe('poi-cable');
    // An unknown subclass: its class still says what it is.
    expect(evaluate(img, { class: 'hospital', subclass: 'nursing_home' })).toBe('poi-health');
    expect(evaluate(img, { class: 'harbor', subclass: 'marina' })).toBe('poi-ferry');
  });

  it("tints it by its group's colour", () => {
    const c = icon.paint['icon-color'];
    expect(evaluate(c, { subclass: 'cafe' })).toBe(palettes.light.poiFood);
    expect(evaluate(c, { subclass: 'bus_stop' })).toBe(palettes.light.poiTransport);
    expect(evaluate(c, { subclass: 'pharmacy' })).toBe(palettes.light.poiHealth);
    expect(evaluate(c, { subclass: 'fuel' })).toBe(palettes.light.poiTransport);
    expect(evaluate(c, { subclass: 'pitch' })).toBe(palettes.light.poiPark);
    // Help when in trouble, one colour: health, fire and police.
    expect(evaluate(c, { subclass: 'police' })).toBe(palettes.light.poiHealth);
    expect(evaluate(c, { subclass: 'fire_station' })).toBe(palettes.light.poiHealth);
    expect(evaluate(c, { subclass: 'company' })).toBe(palettes.light.labelMinor);
  });

  it('has a drawing for every kind that shows one', () => {
    for (const kind of Object.keys(POI_GROUP)) {
      expect(glyphOf(kind as Exclude<PlaceKind, 'person'>), kind).toMatch(/^M/);
    }
  });
});
