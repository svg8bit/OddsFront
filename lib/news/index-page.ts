import { articleCategory, type NewsCategory } from "./categories.ts";
import { articleText } from "./locale.ts";
import { articleSummary } from "./publication.ts";
import type { Locale, NewsCatalog } from "./types.ts";

export const NEWS_INDEX_PAGE_SIZE = 48;
export interface NewsIndexQuery { offset?: number; country?: string; category?: NewsCategory; query?: string; locale?: Locale }

export function newsIndexPage(catalog: NewsCatalog, options: NewsIndexQuery = {}) {
  const articles = catalog.articles.filter(article => !article.withdrawal).toSorted((a, b) =>
    Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const query = (options.query ?? "").trim().slice(0, 160).toLocaleLowerCase();
  const filtered = articles.filter(article => {
    if (options.country && options.country !== "ALL" && !article.countries.includes(options.country)) return false;
    if (options.category && articleCategory(article) !== options.category) return false;
    if (!query) return true;
    const text = articleText(article, options.locale ?? "en");
    return `${text.title} ${text.description}`.toLocaleLowerCase().includes(query);
  });
  const offset = Number.isSafeInteger(options.offset) && options.offset! >= 0 ? options.offset! : 0;
  const page = filtered.slice(offset, offset + NEWS_INDEX_PAGE_SIZE).map(articleSummary);
  const popular = articles.filter(article => Number.isSafeInteger(article.views7d) && (article.views7d ?? 0) > 0)
    .toSorted((a, b) => (b.views7d ?? 0) - (a.views7d ?? 0) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id))
    .slice(0, 5).map(articleSummary);
  return { updatedAt: catalog.updatedAt, articles: page, popular, total: filtered.length,
    nextOffset: offset + page.length < filtered.length ? offset + page.length : null };
}

export function newsOverviewProps(catalog: NewsCatalog, options: NewsIndexQuery = {}) {
  const page = newsIndexPage(catalog, options);
  return { initialArticles: page.articles, initialUpdatedAt: page.updatedAt, initialPopular: page.popular, initialTotal: page.total };
}
