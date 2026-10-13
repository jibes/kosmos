import { describe, expect, it } from 'vitest';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { pickLang } from '../src/i18n';

describe('i18n', () => {
  it('picks the first supported language', () => {
    expect(pickLang(['fr-FR', 'de-AT', 'en'])).toBe('de');
    expect(pickLang(['EN-us'])).toBe('en');
    expect(pickLang([])).toBe('en');
  });

  it('has no empty strings', () => {
    for (const cat of [en, de]) for (const v of Object.values(cat)) expect(v.trim()).not.toBe('');
  });
});
