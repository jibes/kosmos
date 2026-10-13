import type { FontFacesSpecification } from '@maplibre/maplibre-gl-style-spec';
import latin400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import latinExt400 from '@fontsource/inter/files/inter-latin-ext-400-normal.woff2?url';
import latin600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import latinExt600 from '@fontsource/inter/files/inter-latin-ext-600-normal.woff2?url';
import latinItalic from '@fontsource/inter/files/inter-latin-400-italic.woff2?url';
import latinExtItalic from '@fontsource/inter/files/inter-latin-ext-400-italic.woff2?url';
import { FONT } from '../core/style';

// Ranges from @fontsource/inter's CSS; anything outside them falls back to the glyph server.
const LATIN = [
  'U+0000-00FF',
  'U+0131',
  'U+0152-0153',
  'U+02BB-02BC',
  'U+02C6',
  'U+02DA',
  'U+02DC',
  'U+2000-206F',
  'U+20AC',
  'U+2122',
  'U+2212',
];
const LATIN_EXT = [
  'U+0100-02BA',
  'U+02BD-02C5',
  'U+02C7-02CC',
  'U+02CE-02D7',
  'U+02DD-02FF',
  'U+1D00-1DBF',
  'U+1E00-1E9F',
  'U+1EF2-1EFF',
  'U+20A0-20AB',
  'U+20AD-20C0',
  'U+2C60-2C7F',
  'U+A720-A7FF',
];

const abs = (url: string) => new URL(url, document.baseURI).href;
const faces = (latin: string, ext: string) => [
  { url: abs(latin), 'unicode-range': LATIN },
  { url: abs(ext), 'unicode-range': LATIN_EXT },
];

/** Inter drawn by the map itself, so labels match the interface and need no glyph server. */
export const mapFontFaces = (): FontFacesSpecification => ({
  [FONT.regular]: faces(latin400, latinExt400),
  [FONT.bold]: faces(latin600, latinExt600),
  [FONT.italic]: faces(latinItalic, latinExtItalic),
});
