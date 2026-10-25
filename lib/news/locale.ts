import countryNames from "./country-names.json";
import { LOCALES, type Locale, type NewsArticle } from "./types.ts";

export const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", ru: "Русский" };
export function normalizeLocale(value: unknown): Locale | null {
  if (typeof value !== "string") return null;
  const language = value.toLowerCase().split(/[-_]/)[0];
  return LOCALES.find(locale => locale === language) ?? null;
}
export function negotiateLocale(languages: readonly string[]): Locale {
  return languages.map(normalizeLocale).find((locale): locale is Locale => locale !== null) ?? "en";
}
export function regionFromLanguages(languages: readonly string[]) {
  for (const language of languages) {
    try { const region = new Intl.Locale(language).region; if (region && /^[A-Z]{2}$/.test(region)) return region; } catch { /* Ignore malformed browser values. */ }
  }
  return "ALL";
}
export function countryName(code: string, locale: Locale) {
  // Use the same label on the server and browser, regardless of their ICU versions.
  return (countryNames[locale] as Record<string, string>)[code] ?? code;
}
export function articleText(article: NewsArticle, locale: Locale) { return article.translations?.[locale] ?? article; }
