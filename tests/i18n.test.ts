import { describe, expect, it } from 'vitest';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { lang, ordinal, pickLang } from '../src/i18n';

describe('i18n', () => {
  it('picks the first supported language', () => {
    expect(pickLang(['fr-FR', 'de-AT', 'en'])).toBe('de');
    expect(pickLang(['EN-us'])).toBe('en');
    expect(pickLang([])).toBe('en');
  });

  it('has no empty strings', () => {
    for (const cat of [en, de]) for (const v of Object.values(cat)) expect(v.trim()).not.toBe('');
  });

  it('counts the exits of a roundabout as people say them', () => {
    // Tests run in English.
    expect(lang).toBe('en');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
    ]);
  });
});
