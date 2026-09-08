import type { NewsArticle, NewsCatalog } from "./types.ts";

export function articleSummary(article: NewsArticle): NewsArticle {
  return { ...article, body: [], readingMinutes: article.readingMinutes ?? Math.max(1, Math.ceil(article.body.map(block => block.text).join(" ").split(/\s+/).length / 220)),
    translations: Object.fromEntries(Object.entries(article.translations).map(([locale, text]) => [locale, { ...text, body: [] }])) };
}

export function newsIndex(catalog: NewsCatalog) {
  return { updatedAt: catalog.updatedAt, articles: catalog.articles.filter(article => !article.withdrawal).map(articleSummary) };
}
