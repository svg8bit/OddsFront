import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import seed from "./catalog.seed.json";
import type { NewsArticle, NewsCatalog } from "./types";
import { readLiveNewsCatalog } from "./feed-reader";
import { createNewsCatalogCache } from "./catalog-cache";

const getLiveCatalog = createNewsCatalogCache(async () => {
  const rawUrl = process.env.ODDSFRONT_MARKET_FEED_URL;
  const token = process.env.ODDSFRONT_MARKET_FEED_TOKEN;
  if (!rawUrl || !token) throw new Error("Live news feed is not configured");
  // Only successful live results enter the worker cache. A failed refresh
  // leaves its last good catalog intact instead of caching the one-story seed.
  return readLiveNewsCatalog(rawUrl, token, fetch, seed.updatedAt);
});

export const getNewsCatalog = cache(async (): Promise<NewsCatalog> => {
  if (!process.env.ODDSFRONT_MARKET_FEED_URL && !process.env.ODDSFRONT_MARKET_FEED_TOKEN) return seed as NewsCatalog;
  // Defer live reads until a request, before feed retries can catch Next's
  // prerender bailout. Build-time workers must never retain a live snapshot.
  await connection();
  return getLiveCatalog();
});

export const getNewsArticle = cache(async (slug: string): Promise<NewsArticle | null> => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) return null;
  const rawUrl = process.env.ODDSFRONT_MARKET_FEED_URL;
  const token = process.env.ODDSFRONT_MARKET_FEED_TOKEN;
  if (rawUrl && token) {
    // Cached detail responses can outlive a withdrawal at the feed origin.
    // The current public index is authoritative for every article permalink,
    // locale and social image, even when an old detail response remains cached.
    if (!(await getNewsCatalog()).articles.some(article => article.slug === slug && !article.withdrawal)) return null;
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid feed URL");
      url.pathname = `/v1/news/articles/${slug}`; url.search = ""; url.hash = "";
      const response = await fetch(url, {headers:{Authorization:`Bearer ${token}`},next:{revalidate:60},signal:AbortSignal.timeout(4000)});
      if (response.ok) { const article=await response.json() as NewsArticle; if(article.slug===slug&&!article.withdrawal&&Array.isArray(article.body))return article; }
    } catch { /* Existing stories remain readable during a worker outage. */ }
  }
  return (seed as NewsCatalog).articles.find(article=>article.slug===slug)??null;
});
