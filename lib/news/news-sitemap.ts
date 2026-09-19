import { articleText } from "./locale.ts";
import { articleLocales, localeSegment, newsArticlePath } from "./routing.ts";
import { LOCALES, type Locale, type NewsCatalog } from "./types.ts";

const ORIGIN = "https://oddsfront.com";
const NEWS_WINDOW_MS = 48 * 60 * 60_000;
export const NEWS_SITEMAP_URL_LIMIT = 1000;

const xml = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

function recentArticles(catalog: NewsCatalog, locale: Locale, now: number) {
  const cutoff = now - NEWS_WINDOW_MS;
  return catalog.articles.filter((article) =>
    !article.withdrawal &&
    Date.parse(article.publishedAt) >= cutoff &&
    Date.parse(article.publishedAt) <= now &&
    articleLocales(article).includes(locale),
  );
}

function publicationLanguage(locale: Locale): string {
  // Google News requires the ISO 639 language code except for Simplified
  // Chinese, where its sitemap extension expects zh-cn.
  return locale === "zh" ? "zh-cn" : locale.split("-", 1)[0];
}

export function newsSitemapPartName(locale: Locale, part: number): string {
  return `${localeSegment(locale)}-${part}.xml`;
}

export function newsSitemapIndex(catalog: NewsCatalog, now = Date.now()): string {
  const counts = new Map(LOCALES.map((locale) => [locale, recentArticles(catalog, locale, now).length]));
  const hasRecentNews = [...counts.values()].some(Boolean);
  const entries = LOCALES.flatMap((locale) => {
    const count = counts.get(locale) ?? 0;
    // Keep one stable, valid child when the whole catalog has been quiet for
    // 48 hours, but do not advertise empty translated-language sitemaps.
    if (count === 0 && (hasRecentNews || locale !== "en")) return [];
    const parts = Math.max(1, Math.ceil(count / NEWS_SITEMAP_URL_LIMIT));
    return Array.from({ length: parts }, (_, index) =>
      `<sitemap><loc>${ORIGIN}/news-sitemaps/${newsSitemapPartName(locale, index + 1)}</loc><lastmod>${xml(new Date(catalog.updatedAt).toISOString())}</lastmod></sitemap>`,
    );
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`;
}

export function newsSitemap(catalog: NewsCatalog, locale: Locale, part: number, now = Date.now()): string | null {
  if (!Number.isInteger(part) || part < 1) return null;
  const articles = recentArticles(catalog, locale, now);
  const offset = (part - 1) * NEWS_SITEMAP_URL_LIMIT;
  if (part > 1 && offset >= articles.length) return null;
  const urls = articles.slice(offset, offset + NEWS_SITEMAP_URL_LIMIT).map((article) => {
    const text = articleText(article, locale);
    const href = `${ORIGIN}${newsArticlePath(article, locale)}`;
    return `<url><loc>${xml(href)}</loc><news:news><news:publication><news:name>OddsFront</news:name><news:language>${publicationLanguage(locale)}</news:language></news:publication><news:publication_date>${xml(article.publishedAt)}</news:publication_date><news:title>${xml(text.title)}</news:title></news:news></url>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${urls}</urlset>`;
}

export function newsSitemapLocale(value: string): Locale | null {
  return LOCALES.find((locale) => localeSegment(locale) === value.toLowerCase()) ?? null;
}
