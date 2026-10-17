import { FEED_TIMEOUT_MS } from "./feed-health.ts";
import type { NewsCatalog } from "./types";

// One attempt with a short timeout: a dead host then costs a regeneration at
// most FEED_TIMEOUT_MS once, after which lib/news/feed-health.ts remembers the
// failure and callers serve their fallbacks without touching the network.
export async function readLiveNewsCatalog(rawUrl: string, token: string, request: typeof fetch = fetch, minimumUpdatedAt = "1970-01-01T00:00:00Z", timeoutMs = FEED_TIMEOUT_MS): Promise<NewsCatalog> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid news feed URL");
  url.pathname = "/v1/news"; url.search = ""; url.hash = "";
  try {
    // Default fetch mode, not `cache: "no-store"`: an explicit no-store opts
    // the whole page out of ISR, while the Authorization header already keeps
    // this multi-megabyte response out of Next's persistent Data Cache.
    const response = await request(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`News feed unavailable (${response.status})`);
    const data = await response.json() as NewsCatalog;
    if (data.version !== 1 || !Array.isArray(data.articles) || !data.articles.length ||
      !Number.isFinite(Date.parse(data.updatedAt)) || Date.parse(data.updatedAt) < Date.parse(minimumUpdatedAt) || Date.parse(data.updatedAt) > Date.now() + 60_000 ||
      data.articles.some(article => !article || typeof article.id !== "string" || typeof article.slug !== "string" || typeof article.title !== "string" || !Array.isArray(article.body))) {
      throw new Error("Invalid news catalog");
    }
    return data;
  } catch {
    throw new Error("Live news feed unavailable");
  }
}
