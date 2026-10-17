import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import seed from "./catalog.seed.json";
import type { NewsArticle, NewsCatalog } from "./types";
import { readLiveNewsCatalog } from "./feed-reader";
import { createNewsCatalogCache } from "./catalog-cache";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FEED_TIMEOUT_MS = 4_000;

function liveFeed(): { rawUrl: string; token: string } | null {
  const rawUrl = process.env.ODDSFRONT_MARKET_FEED_URL;
  const token = process.env.ODDSFRONT_MARKET_FEED_TOKEN;
  return rawUrl && token ? { rawUrl, token } : null;
}

const getLiveCatalog = createNewsCatalogCache(async () => {
  const feed = liveFeed();
  if (!feed) throw new Error("Live news feed is not configured");
  // Only successful live results enter the worker cache. A failed refresh
  // leaves its last good catalog intact instead of caching the one-story seed.
  return readLiveNewsCatalog(feed.rawUrl, feed.token, fetch, seed.updatedAt);
});

// A build machine may not reach the feed (Vercel preview builds do not). The
// prerendered placeholder must then expire at once: a one-second cache entry
// read during this render lowers the route's revalidation window for this
// render only, so the first real request regenerates the page from the live
// feed and that regeneration carries the route's normal window again.
const expirePlaceholderImmediately = unstable_cache(
  async () => "placeholder",
  ["oddsfront-news-build-placeholder-v1"],
  { revalidate: 1 },
);

// News pages, sitemaps and feeds are cached by Next's ISR layer through their
// `revalidate` exports, so the catalog is read once per revalidation window
// instead of once per request. This reader therefore calls no dynamic API and
// the feed request uses the default fetch mode: its Authorization header keeps
// the multi-megabyte archive out of the persistent Data Cache at runtime. At
// runtime a failed read throws, so an ISR regeneration keeps serving the
// previous page rather than caching an empty or seed-only edition.
export const getNewsCatalog = cache(async (): Promise<NewsCatalog> => {
  if (!process.env.ODDSFRONT_MARKET_FEED_URL && !process.env.ODDSFRONT_MARKET_FEED_TOKEN) return seed as NewsCatalog;
  try {
    return await getLiveCatalog();
  } catch (error) {
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw error;
    console.warn("Live news feed unavailable during the build; prerendering a seed placeholder that expires immediately.",
      error instanceof Error ? error.message : "Unknown error");
    await expirePlaceholderImmediately();
    return seed as NewsCatalog;
  }
});

export const getNewsArticle = cache(async (slug: string): Promise<NewsArticle | null> => {
  if (!SLUG_PATTERN.test(slug) || slug.length > 100) return null;
  const feed = liveFeed();
  if (!feed) return (seed as NewsCatalog).articles.find(article => article.slug === slug) ?? null;
  const url = new URL(feed.rawUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid feed URL");
  url.pathname = `/v1/news/articles/${slug}`; url.search = ""; url.hash = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Detail responses are never stored in Next's Data Cache (default fetch
      // mode with an Authorization header), so a withdrawal cannot be
      // resurrected from a cached detail: the publisher removes the detail
      // file and the feed answers 404, which is authoritative here.
      const response = await fetch(url, { headers: { Authorization: `Bearer ${feed.token}` }, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`News article feed unavailable (${response.status})`);
      const article = await response.json() as NewsArticle;
      return article.slug === slug && !article.withdrawal && Array.isArray(article.body) ? article : null;
    } catch (error) {
      // Throwing (instead of returning null) keeps ISR from caching a 404 for
      // an existing story during a feed outage; the previous page stays live.
      if (attempt === 1) throw error instanceof Error ? error : new Error("News article feed unavailable");
    }
  }
  throw new Error("News article feed unavailable");
});
