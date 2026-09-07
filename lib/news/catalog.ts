import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import seed from "./catalog.seed.json";
import type { NewsArticle, NewsCatalog } from "./types";
import { readLiveNewsCatalog } from "./feed-reader";

const getLiveCatalog = unstable_cache(async () => {
  const rawUrl = process.env.ODDSFRONT_MARKET_FEED_URL;
  const token = process.env.ODDSFRONT_MARKET_FEED_TOKEN;
  if (!rawUrl || !token) throw new Error("Live news feed is not configured");
  // Only successful live results enter the persistent cache. A failed refresh
  // leaves its last good catalog intact instead of caching the one-story seed.
  return readLiveNewsCatalog(rawUrl, token, fetch, seed.updatedAt);
}, ["oddsfront-live-news-catalog-v2"], { revalidate: 30 });

export const getNewsCatalog = cache(async (): Promise<NewsCatalog> => {
  if (!process.env.ODDSFRONT_MARKET_FEED_URL && !process.env.ODDSFRONT_MARKET_FEED_TOKEN) return seed as NewsCatalog;
  return getLiveCatalog();
});

export const getNewsArticle = cache(async (slug: string): Promise<NewsArticle | null> => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) return null;
  const rawUrl = process.env.ODDSFRONT_MARKET_FEED_URL;
  const token = process.env.ODDSFRONT_MARKET_FEED_TOKEN;
  if (rawUrl && token) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid feed URL");
      url.pathname = `/v1/news/articles/${slug}`; url.search = ""; url.hash = "";
      const response = await fetch(url, {headers:{Authorization:`Bearer ${token}`},next:{revalidate:60},signal:AbortSignal.timeout(4000)});
      if (response.ok) { const article=await response.json() as NewsArticle; if(article.slug===slug&&Array.isArray(article.body))return article; }
    } catch { /* Existing stories remain readable during a worker outage. */ }
  }
  return (seed as NewsCatalog).articles.find(article=>article.slug===slug)??null;
});
