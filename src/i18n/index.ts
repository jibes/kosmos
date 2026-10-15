import { de } from './de';
import { en, type Catalogue } from './en';
import { unitsFor } from '../core/route';

const catalogues: Record<string, Catalogue> = { en, de };

/** First supported language from the browser's preference list, else English. */
export function pickLang(preferred: readonly string[]): string {
  for (const tag of preferred) {
    const lang = tag.toLowerCase().split('-')[0];
    if (lang in catalogues) return lang;
  }
  return 'en';
}

export const lang = pickLang(typeof navigator === 'undefined' ? [] : navigator.languages);
export const t: Catalogue = catalogues[lang];
/**
 * The browser's own locale for the UI language (en-GB, de-AT), for clocks, dates and numbers:
 * the language alone would give an English user in Britain 12-hour times.
 */
export const locale =
  (typeof navigator === 'undefined' ? [] : navigator.languages).find(
    (l) => l.toLowerCase().split('-')[0] === lang,
  ) ?? lang;

/** Text that starts a line: "arrival 09:36" in a sentence, "Arrival 09:36" on its own. */
export const capital = (s: string) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);

/** Road units follow the region (en-US: miles), whatever the UI language. */
export const units = unitsFor(typeof navigator === 'undefined' ? '' : navigator.language);

/** Fills `{name}` placeholders: `fill(t.walkTo, { stop: 'Hbf' })`. */
export const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all));
