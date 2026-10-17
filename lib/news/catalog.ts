import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import seed from "./catalog.seed.json";
import type { NewsArticle, NewsCatalog } from "./types";
import { readLiveNewsCatalog } from "./feed-reader";
import { createNewsCatalogCache } from "./catalog-cache";
import { FEED_RETRY_SECONDS, FEED_TIMEOUT_MS, feedCoolingDown, rememberFeedFailure, rememberFeedSuccess } from "./feed-health";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function liveFeed(): { rawUrl: string; token: string } | null {
  const rawUrl = process.env.ODDSFRONT_MARKET_FEED_URL;
  const token = process.env.ODDSFRONT_MARKET_FEED_TOKEN;
  return rawUrl && token ? { rawUrl, token } : null;
}

function warnFeedFailure(what: string, error: unknown) {
  console.warn(`${what}; serving seed fallbacks for ${FEED_RETRY_SECONDS}s before trying the feed again.`,
    error instanceof Error ? error.message : "Unknown error");
}

const getLiveCatalog = createNewsCatalogCache(async () => {
  const feed = liveFeed();
  if (!feed) throw new Error("Live news feed is not configured");
  if (feedCoolingDown()) throw new Error("Live news feed unavailable (recent failure)");
  try {
    // Only successful live results enter the worker cache. A failed refresh
    // leaves its last good catalog intact instead of caching the one-story seed.
    const catalog = await readLiveNewsCatalog(feed.rawUrl, feed.token, fetch, seed.updatedAt);
    rememberFeedSuccess();
    return catalog;
  } catch (error) {
    rememberFeedFailure();
    warnFeedFailure("Live news feed unavailable", error);
    throw error;
  }
});

// A fallback render must not keep the route's normal window: reading a short
// cache entry during the render lowers the revalidation window of that render
// only, so the next request after the window regenerates from the live feed
// and that regeneration carries the route's own window again. Build machines
// may not reach the feed at all (Vercel preview builds), so a build placeholder
// expires at once; a runtime outage placeholder lasts one retry period.
const expireBuildPlaceholder = unstable_cache(async () => "build", ["oddsfront-news-placeholder-build-v1"], { revalidate: 1 });
const expireOutagePlaceholder = unstable_cache(async () => "outage", ["oddsfront-news-placeholder-outage-v1"], { revalidate: FEED_RETRY_SECONDS });

async function seedFallback(): Promise<NewsCatalog> {
  await (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD ? expireBuildPlaceholder : expireOutagePlaceholder)();
  return seed as NewsCatalog;
}

// News pages, sitemaps and feeds are cached by Next's ISR layer through their
// `revalidate` exports, so the catalog is read once per revalidation window
// instead of once per request. This reader therefore calls no dynamic API and
// the feed request uses the default fetch mode: its Authorization header keeps
// the multi-megabyte archive out of the persistent Data Cache at runtime. When
// the feed cannot be read, a warm worker keeps its last good catalog and a cold
// worker serves the bundled seed with a short window, so no route fails and
// the site recovers by itself once the feed answers again.
export const getNewsCatalog = cache(async (): Promise<NewsCatalog> => {
  if (!process.env.ODDSFRONT_MARKET_FEED_URL && !process.env.ODDSFRONT_MARKET_FEED_TOKEN) return seed as NewsCatalog;
  try {
    return await getLiveCatalog();
  } catch {
    return seedFallback();
  }
});

export const getNewsArticle = cache(async (slug: string): Promise<NewsArticle | null> => {
  if (!SLUG_PATTERN.test(slug) || slug.length > 100) return null;
  const fromSeed = () => (seed as NewsCatalog).articles.find(article => article.slug === slug) ?? null;
  const feed = liveFeed();
  if (!feed) return fromSeed();
  if (feedCoolingDown()) {
    await expireOutagePlaceholder();
    return fromSeed();
  }
  const url = new URL(feed.rawUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid feed URL");
  url.pathname = `/v1/news/articles/${slug}`; url.search = ""; url.hash = "";
  try {
    // Detail responses are never stored in Next's Data Cache (default fetch
    // mode with an Authorization header), so a withdrawal cannot be
    // resurrected from a cached detail: the publisher removes the detail
    // file and the feed answers 404, which is authoritative here.
    const response = await fetch(url, { headers: { Authorization: `Bearer ${feed.token}` }, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
    if (response.status === 404) { rememberFeedSuccess(); return null; }
    if (!response.ok) throw new Error(`News article feed unavailable (${response.status})`);
    const article = await response.json() as NewsArticle;
    rememberFeedSuccess();
    return article.slug === slug && !article.withdrawal && Array.isArray(article.body) ? article : null;
  } catch (error) {
    // An unreachable feed yields a short-lived 404 for unknown slugs instead
    // of a 500 on every crawler hit; the page is retried after the window.
    rememberFeedFailure();
    warnFeedFailure("News article feed unavailable", error);
    await expireOutagePlaceholder();
    return fromSeed();
  }
});
