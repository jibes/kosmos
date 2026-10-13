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

  it('keeps both palettes structurally identical', () => {
    const keys = (p: Palette) => Object.keys(p).sort();
    expect(keys(palettes.light)).toEqual(keys(palettes.dark));
  });
});
