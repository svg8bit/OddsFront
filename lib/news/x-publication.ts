import type { NewsArticle } from "./types.ts";
import { newsArticlePath } from "./routing.ts";

export const X_NEWS_ACCOUNT = "alotofbit";
export const X_NEWS_INTERVAL_MS = 2 * 60 * 60_000;

export function xNewsPayload(article: NewsArticle) {
  const url = `https://oddsfront.com${newsArticlePath(article, "en")}`;
  const title = article.title.replace(/\s+/g, " ").trim();
  if (!title || Array.from(title).length + 28 > 280) throw new Error("Article headline exceeds the X post limit");
  return { text: `🗞 ${title}\n${url}` };
}

export function xNewsArticle(articles: NewsArticle[], telegramArticleIds: readonly string[], sentIds: readonly string[], now = Date.now()): NewsArticle | null {
  // Reuse the editorial choice actually published to Telegram; do not choose a
  // different or older story just because the X timer runs a few minutes later.
  const article = articles.find(item => item.id === telegramArticleIds.at(-1));
  if (!article || sentIds.includes(article.id)) return null;
  const publishedAt = Date.parse(article.publishedAt);
  return Number.isFinite(publishedAt) && publishedAt <= now && now - publishedAt <= 3 * 60 * 60_000 ? article : null;
}
