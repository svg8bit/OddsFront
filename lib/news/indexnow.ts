import { articleCategory, type NewsCategory } from "./categories.ts";
import { NEWS_INDEX_PAGE_SIZE } from "./constants.ts";
import { articleLocales, newsArticlePath, newsCountryPath, newsPath, newsTopicPath } from "./routing.ts";
import { LOCALES, type Locale, type NewsCatalog } from "./types.ts";

const ORIGIN = "https://oddsfront.com";
export const INDEXNOW_URL_LIMIT = 10_000;

interface IndexNowArticleSnapshot {
  slug: string;
  updatedAt: string;
  locales: Locale[];
  countries: string[];
  category: NewsCategory;
}

export interface IndexNowSnapshot {
  version: 1;
  articles: Record<string, IndexNowArticleSnapshot>;
}

export interface IndexNowPlan {
  urls: string[];
  snapshot: IndexNowSnapshot;
  changedArticles: number;
}

export function buildIndexNowSnapshot(catalog: NewsCatalog): IndexNowSnapshot {
  const articles = catalog.articles
    .filter((article) => !article.withdrawal)
    .toSorted((left, right) => left.id.localeCompare(right.id));
  return {
    version: 1,
    articles: Object.fromEntries(articles.map((article) => [article.id, {
      slug: article.slug,
      updatedAt: article.updatedAt,
      locales: articleLocales(article),
      countries: article.countries.map((country) => country.toLowerCase()).toSorted(),
      category: articleCategory(article),
    }])),
  };
}

export function isIndexNowSnapshot(value: unknown): value is IndexNowSnapshot {
  return Boolean(value && typeof value === "object" && (value as IndexNowSnapshot).version === 1 &&
    (value as IndexNowSnapshot).articles && typeof (value as IndexNowSnapshot).articles === "object");
}

function addArticleUrls(urls: Set<string>, article: IndexNowArticleSnapshot) {
  for (const locale of article.locales) urls.add(`${ORIGIN}${newsArticlePath(article, locale)}`);
}

function addListingUrls(urls: Set<string>, articles: IndexNowArticleSnapshot[]) {
  const countries = new Set(articles.flatMap((article) => article.countries));
  const categories = new Set(articles.map((article) => article.category));
  for (const locale of LOCALES) {
    urls.add(`${ORIGIN}${newsPath(locale)}`);
    for (const country of countries) urls.add(`${ORIGIN}${newsCountryPath(country, locale)}`);
    for (const category of categories) urls.add(`${ORIGIN}${newsTopicPath(category, locale)}`);
  }
}

function addArchiveUrls(urls: Set<string>, articleCount: number) {
  const pages = Math.max(1, Math.ceil(articleCount / NEWS_INDEX_PAGE_SIZE));
  for (let page = 1; page <= pages; page++) {
    urls.add(`${ORIGIN}/news/archive${page === 1 ? "" : `?page=${page}`}`);
  }
}

export function buildIndexNowPlan(
  catalog: NewsCatalog,
  previous: IndexNowSnapshot | null,
  full = false,
): IndexNowPlan {
  const snapshot = buildIndexNowSnapshot(catalog);
  const currentIds = Object.keys(snapshot.articles);
  const previousIds = previous ? Object.keys(previous.articles) : [];
  const ids = new Set([...currentIds, ...previousIds]);
  const changedIds = [...ids].filter((id) => {
    if (full || !previous) return true;
    return JSON.stringify(snapshot.articles[id]) !== JSON.stringify(previous.articles[id]);
  });
  const urls = new Set<string>();
  if (changedIds.length === 0) return { urls: [], snapshot, changedArticles: 0 };

  urls.add(ORIGIN);
  const affected: IndexNowArticleSnapshot[] = [];
  for (const id of changedIds) {
    const current = snapshot.articles[id];
    const old = previous?.articles[id];
    if (current) { addArticleUrls(urls, current); affected.push(current); }
    if (old) { addArticleUrls(urls, old); affected.push(old); }
  }
  addListingUrls(urls, full ? Object.values(snapshot.articles) : affected);
  addArchiveUrls(urls, currentIds.length);
  if (previous) addArchiveUrls(urls, previousIds.length);
  if (!previous || full) {
    urls.add(`${ORIGIN}/news/about`);
    // Tell participating engines once that the former duplicate now redirects
    // to the canonical root. It is never included in a sitemap or later delta.
    urls.add(`${ORIGIN}/global-conflict-map`);
    for (const locale of LOCALES) urls.add(`${ORIGIN}${newsCountryPath("world", locale)}`);
  }

  return { urls: [...urls], snapshot, changedArticles: changedIds.length };
}

export function indexNowBatches(urls: string[]): string[][] {
  return Array.from({ length: Math.ceil(urls.length / INDEXNOW_URL_LIMIT) }, (_, index) =>
    urls.slice(index * INDEXNOW_URL_LIMIT, (index + 1) * INDEXNOW_URL_LIMIT),
  );
}
