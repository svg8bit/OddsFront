import { LOCALES, type Locale, type NewsArticle } from "./types.ts";

export const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", zh: "中文", ko: "한국어", vi: "Tiếng Việt", de: "Deutsch", es: "Español", "pt-BR": "Português (Brasil)", fr: "Français", ru: "Русский", uk: "Українська", fa: "فارسی", he: "עברית" };
export function normalizeLocale(value: unknown): Locale | null {
  if (typeof value !== "string") return null;
  const language = value.toLowerCase().split(/[-_]/)[0];
  if (language === "pt") return "pt-BR";
  if (language === "iw") return "he";
  return LOCALES.find(locale => locale === language) ?? null;
}
export function negotiateLocale(languages: readonly string[]): Locale {
  return languages.map(normalizeLocale).find((locale): locale is Locale => locale !== null) ?? "en";
}
export function localeDirection(locale: Locale) { return locale === "fa" || locale === "he" ? "rtl" : "ltr"; }
export function regionFromLanguages(languages: readonly string[]) {
  for (const language of languages) {
    try { const region = new Intl.Locale(language).region; if (region && /^[A-Z]{2}$/.test(region)) return region; } catch { /* Ignore malformed browser values. */ }
  }
  return "ALL";
}
export function countryName(code: string, locale: Locale) {
  try { return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code; } catch { return code; }
}
export function articleText(article: NewsArticle, locale: Locale) { return article.translations[locale] ?? article; }
