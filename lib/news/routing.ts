import { LOCALES, type Locale, type NewsArticle } from "./types.ts";

export const NON_ENGLISH_LOCALES = LOCALES.filter(
  (locale): locale is Exclude<Locale, "en"> => locale !== "en",
);

export function localeSegment(locale: Locale): string {
  return locale.toLowerCase();
}

export function newsPath(locale: Locale, suffix = ""): string {
  const prefix = locale === "en" ? "" : `/${localeSegment(locale)}`;
  return `${prefix}/news${suffix}`;
}

export function newsCountryPath(country: string, locale: Locale): string {
  return newsPath(locale, `/${country.toLowerCase()}`);
}

export function newsArticlePath(
  article: Pick<NewsArticle, "countries" | "slug">,
  locale: Locale,
): string {
  return newsCountryPath(article.countries[0] || "world", locale) + `/${article.slug}`;
}

export function switchNewsLocalePath(pathname: string, locale: Locale): string {
  const segments = pathname.split("/").filter(Boolean);
  const firstLocale = segments[0]
    ? LOCALES.find((candidate) => localeSegment(candidate) === segments[0].toLowerCase())
    : undefined;
  const baseSegments = firstLocale ? segments.slice(1) : segments;
  if (baseSegments[0] !== "news") return pathname;
  const base = `/${baseSegments.join("/")}`;
  return locale === "en" ? base : `/${localeSegment(locale)}${base}`;
}

export function languageAlternates(
  englishPath: string,
  locales: readonly Locale[] = LOCALES,
): Record<string, string> {
  const suffix = englishPath === "/news" ? "" : englishPath.slice("/news".length);
  const entries = locales.map((locale) => [locale, newsPath(locale, suffix)] as const);
  return Object.fromEntries([...entries, ["x-default", englishPath]]);
}

export function articleLocales(article: NewsArticle): Locale[] {
  return LOCALES.filter(
    (locale) => locale === "en" || Boolean(article.translations[locale]),
  );
}
