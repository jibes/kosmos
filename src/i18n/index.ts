import { de } from './de';
import { en, type Catalogue } from './en';

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

/** Fills `{name}` placeholders: `fill(t.walkTo, { stop: 'Hbf' })`. */
export const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all));
