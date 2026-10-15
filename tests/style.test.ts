import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { palettes, type Palette } from '../src/core/palette';
import { FONT, LABEL_LAYERS, buildStyle } from '../src/core/style';

describe('buildStyle', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`produces a valid ${theme} style`, () => {
      const style = buildStyle({
        theme,
        lang: 'de',
        fontFaces: { [FONT.regular]: [{ url: 'https://x/a.woff2', 'unicode-range': ['U+0-FF'] }] },
      });
      expect(validateStyleMin(style)).toEqual([]);
    });
  }

  it('has unique layer ids and every label layer exists', () => {
    const ids = buildStyle({ theme: 'light', lang: 'en' }).layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of LABEL_LAYERS) expect(ids).toContain(id);
  });

  it('prefers the label language for place names', () => {
    const style = buildStyle({ theme: 'light', lang: 'fr' });
    const city = style.layers.find((l) => l.id === 'label-city');
    expect(JSON.stringify(city)).toContain('name:fr');
  });

  it('draws only with palette colours', () => {
    const json = JSON.stringify(buildStyle({ theme: 'dark', lang: 'en' }));
    const used = new Set(json.match(/#[0-9a-f]{6}\b/gi));
    const allowed = new Set([...Object.values(palettes.dark), '#ffffff'] as (string | number)[]);
    for (const c of used) expect(allowed).toContain(c);
  });

  it('hangs place labels below their point, where a pin standing on it leaves them readable', () => {
    const poi = buildStyle({ theme: 'light', lang: 'en' }).layers.find((l) => l.id === 'label-poi');
    expect(poi?.layout).toMatchObject({ 'text-anchor': 'top' });
  });

  it('keeps streets and water apart from buildings and land at night', () => {
    // WCAG relative luminance: how far apart two fills read, not as text but as shapes.
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => (lum(a) + 0.05) / (lum(b) + 0.05);
    const d = palettes.dark;
    expect(ratio(d.roadMinor, d.building)).toBeGreaterThan(1.25);
    expect(ratio(d.roadMinor, d.land)).toBeGreaterThan(1.25);
    expect(ratio(d.water, d.land)).toBeGreaterThan(1.1);
  });

  it('keeps both palettes structurally identical', () => {
    const keys = (p: Palette) => Object.keys(p).sort();
    expect(keys(palettes.light)).toEqual(keys(palettes.dark));
  });
});
