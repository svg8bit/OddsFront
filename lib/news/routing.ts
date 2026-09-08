import { LOCALES, type Locale, type NewsArticle } from "./types.ts";
import type { NewsCategory } from "./categories.ts";

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

export function isNewsCountrySegment(value: string): boolean {
  return value === "world" || /^[a-z]{2}$/.test(value);
}

export function newsCountryPath(country: string, locale: Locale): string {
  return newsPath(locale, `/${country.toLowerCase()}`);
}

export function newsTopicPath(topic: NewsCategory, locale: Locale): string {
  return newsPath(locale, `/topic/${topic}`);
}

export function newsArticlePath(
  article: Pick<NewsArticle, "slug">,
  locale: Locale,
): string {
  return `/${localeSegment(locale)}/news/${article.slug}`;
}

export function availableNewsArticlePath(article: NewsArticle, locale: Locale): string {
  return newsArticlePath(
    article,
    locale === "en" || article.translations[locale] ? locale : "en",
  );
}

export function switchNewsLocalePath(pathname: string, locale: Locale): string {
  const segments = pathname.split("/").filter(Boolean);
  const firstLocale = segments[0]
    ? LOCALES.find((candidate) => localeSegment(candidate) === segments[0].toLowerCase())
    : undefined;
  const baseSegments = firstLocale ? segments.slice(1) : segments;
  if (baseSegments[0] !== "news") return pathname;
  if (baseSegments.length === 2 && ["about", "archive"].includes(baseSegments[1])) {
    return `/${baseSegments.join("/")}`;
  }
  const articleSlug = baseSegments.length === 3 && isNewsCountrySegment(baseSegments[1])
    ? baseSegments[2]
    : baseSegments.length === 2 && !isNewsCountrySegment(baseSegments[1]) && baseSegments[1] !== "rss.xml"
      ? baseSegments[1] : null;
  if (articleSlug) return newsArticlePath({ slug: articleSlug }, locale);
  const base = `/${baseSegments.join("/")}`;
  return locale === "en" ? base : `/${localeSegment(locale)}${base}`;
}

export function languageAlternates(
  englishPath: string,
  locales: readonly Locale[] = LOCALES,
): Record<string, string> {
  if (englishPath.startsWith("/en/news/")) {
    const slug = englishPath.slice("/en/news/".length);
    const entries = locales.map(locale => [locale, newsArticlePath({ slug }, locale)] as const);
    return Object.fromEntries([...entries, ["x-default", englishPath]]);
  }
  const suffix = englishPath === "/news" ? "" : englishPath.slice("/news".length);
  const entries = locales.map((locale) => [locale, newsPath(locale, suffix)] as const);
  return Object.fromEntries([...entries, ["x-default", englishPath]]);
}

export function articleLocales(article: NewsArticle): Locale[] {
  return LOCALES.filter(
    (locale) => locale === "en" || Boolean(article.translations[locale]),
  );
}
