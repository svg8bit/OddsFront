// Paths the token-protected revalidation route may refresh: news listings,
// feeds, topic and country pages, article pages and the sitemaps.
const LOCALE = "(?:en|ru)";
const ALLOWED_PATHS = [
  new RegExp(`^(?:/${LOCALE})?/news(?:/rss\\.xml|/archive(?:/[1-9]\\d{0,3})?|/topic/[a-z]{3,20}|/[a-z]{2})?$`),
  new RegExp(`^/${LOCALE}/news/[a-z0-9]+(?:-[a-z0-9]+)*$`),
  /^\/news-sitemap\.xml$/,
  /^\/news-sitemaps\/(?:en|ru)-\d{1,3}\.xml$/,
  /^\/sitemap\.xml$/,
  /^\/sitemaps\/(?:core|articles-\d{1,3})\.xml$/,
];
export const MAX_REVALIDATION_PATHS = 80;

export function isRevalidationPath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 140 && ALLOWED_PATHS.some(pattern => pattern.test(value));
}
