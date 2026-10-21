import { describe, expect, it } from 'vitest';
import { expression } from '@maplibre/maplibre-gl-style-spec';
import { palettes } from '../src/core/palette';
import { poiIcon } from '../src/core/stylePoi';

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
  });

  it("tints it by its group's colour", () => {
    const c = icon.paint['icon-color'];
    expect(evaluate(c, { subclass: 'cafe' })).toBe(palettes.light.poiFood);
    expect(evaluate(c, { subclass: 'bus_stop' })).toBe(palettes.light.poiTransport);
    expect(evaluate(c, { subclass: 'pharmacy' })).toBe(palettes.light.poiHealth);
    expect(evaluate(c, { subclass: 'company' })).toBe(palettes.light.labelMinor);
  });
});
