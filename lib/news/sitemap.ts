import { articleLocales, languageAlternates, localeSegment, newsArticlePath, newsCountryPath, newsTopicPath } from "./routing.ts";
import { NEWS_CATEGORIES } from "./categories.ts";
import { listingIndexable } from "./index-page.ts";
import { LOCALES, type Locale, type NewsCatalog } from "./types.ts";

export const SITEMAP_ARTICLE_BATCH_SIZE = 200;
const ORIGIN = "https://oddsfront.com";

const escapeXml = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

function sitemapDocument(urls: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls}</urlset>`;
}

function alternates(englishPath: string, locales: readonly Locale[] = LOCALES): string {
  return Object.entries(languageAlternates(englishPath, locales))
    .map(([language, path]) => `<xhtml:link rel="alternate" hreflang="${escapeXml(language)}" href="${escapeXml(`${ORIGIN}${path}`)}"/>`)
    .join("");
}

function urlEntry({
  path,
  updatedAt,
  alternateLinks = "",
  image,
  priority,
}: {
  path: string;
  updatedAt: string;
  alternateLinks?: string;
  image?: string;
  priority: string;
}): string {
  return `<url><loc>${escapeXml(`${ORIGIN}${path}`)}</loc><lastmod>${escapeXml(new Date(updatedAt).toISOString())}</lastmod><changefreq>hourly</changefreq><priority>${priority}</priority>${alternateLinks}${image ? `<image:image><image:loc>${escapeXml(image)}</image:loc></image:image>` : ""}</url>`;
}

export function sitemapIndex(catalog: NewsCatalog): string {
  const activeArticles = catalog.articles.filter((article) => !article.withdrawal);
  const pages = Math.max(1, Math.ceil(activeArticles.length / SITEMAP_ARTICLE_BATCH_SIZE));
  const locations = ["core.xml", ...Array.from({ length: pages }, (_, index) => `articles-${index + 1}.xml`)];
  const lastModified = [catalog.updatedAt, ...activeArticles.map((article) => article.updatedAt)]
    .reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
  const entries = locations.map((location) => `<sitemap><loc>${ORIGIN}/sitemaps/${location}</loc><lastmod>${escapeXml(new Date(lastModified).toISOString())}</lastmod></sitemap>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`;
}

export function coreSitemap(catalog: NewsCatalog): string {
  const activeArticles = catalog.articles.filter((article) => !article.withdrawal);
  // Only listings that are indexable (see listingIndexable); the archive repeats /news and stays out.
  const countries = [...new Set(activeArticles.flatMap((article) => article.countries))]
    .filter((country) => listingIndexable(catalog, { country }))
    .map((country) => country.toLowerCase());
  const categories = NEWS_CATEGORIES.filter((topic) => listingIndexable(catalog, { category: topic }));
  // Every language version gets its own <url> carrying the full set of alternates.
  const listing = (englishPath: string, priority: string) => {
    const paths = languageAlternates(englishPath);
    return LOCALES.map((locale) => urlEntry({ path: paths[locale], updatedAt: catalog.updatedAt, priority, alternateLinks: alternates(englishPath) }));
  };
  const urls = [
    urlEntry({ path: "", updatedAt: catalog.updatedAt, priority: "1.0" }),
    urlEntry({ path: "/news/about", updatedAt: catalog.updatedAt, priority: "0.5" }),
    ...listing("/news", "0.9"),
    ...categories.flatMap((topic) => listing(newsTopicPath(topic, "en"), "0.8")),
    ...countries.flatMap((country) => listing(newsCountryPath(country, "en"), "0.7")),
  ];
  return sitemapDocument(urls.join(""));
}

export function articleSitemap(catalog: NewsCatalog, page: number): string | null {
  const activeArticles = catalog.articles.filter((article) => !article.withdrawal);
  const offset = (page - 1) * SITEMAP_ARTICLE_BATCH_SIZE;
  if (!Number.isInteger(page) || page < 1 || (offset >= activeArticles.length && page !== 1)) return null;
  const urls = activeArticles.slice(offset, offset + SITEMAP_ARTICLE_BATCH_SIZE).flatMap((article) => {
    const locales = articleLocales(article);
    const alternateLinks = alternates(newsArticlePath(article, "en"), locales);
    return locales.map((locale) => urlEntry({
      path: newsArticlePath(article, locale),
      updatedAt: article.updatedAt,
      priority: "0.8",
      alternateLinks,
      image: `${ORIGIN}/social/news/${localeSegment(locale)}/${article.slug}?v=${encodeURIComponent(article.updatedAt)}`,
    }));
  });
  return sitemapDocument(urls.join(""));
}
