import { NEWS_SOURCES, isNewsPublisher, sourceHost } from "./sources.ts";
import { canonicalStoryUrl, findDuplicateStory, isDuplicateTitle } from "./duplicates.ts";
import { normalizePartnerImageUrl } from "./partner-covers.ts";
import type { NewsArticle } from "./types.ts";

// Public publisher feeds supply leads, never substitute for article verification.
export const NEWS_DISCOVERY_FEEDS = [
  { publisher: "BBC", url: "https://feeds.bbci.co.uk/news/world/rss.xml", articleHosts: ["bbc.com", "bbc.co.uk"] },
  { publisher: "The Guardian", url: "https://www.theguardian.com/world/rss", articleHosts: ["theguardian.com"] },
  { publisher: "Euronews", url: "https://www.euronews.com/rss?level=vertical&name=news", articleHosts: ["euronews.com"] },
  { publisher: "Sky News", url: "https://feeds.skynews.com/feeds/rss/world.xml", articleHosts: ["news.sky.com"] },
  { publisher: "Meduza", url: "https://meduza.io/rss/all", articleHosts: ["meduza.io"] },
  { publisher: "Axios", url: "https://api.axios.com/feed/", articleHosts: ["axios.com"] },
  { publisher: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", articleHosts: ["aljazeera.com"] },
] as const;
export type NewsDiscoveryLead = { publisher: string; title: string; url: string; publishedAt: string; photoCandidate: boolean };
export type NewsFeedDiscovery = {
  collectedAt: string;
  feeds: { publisher: string; url: string; status: "available" | "unavailable"; candidates: number }[];
  leads: NewsDiscoveryLead[];
};
const MAX_FEED_BYTES = 1_500_000;
const MAX_SOURCE_AGE_MS = 72 * 60 * 60_000;

function xmlText(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "").replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, value => {
    const known: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" };
    if (known[value.toLowerCase()]) return known[value.toLowerCase()];
    const hex = value.toLowerCase().startsWith("&#x");
    const number = Number.parseInt(value.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
  }).replace(/\s+/g, " ").trim();
}

export function parseNewsDiscoveryFeed(xml: string, feed: typeof NEWS_DISCOVERY_FEEDS[number], now = Date.now()): NewsDiscoveryLead[] {
  const leads: NewsDiscoveryLead[] = [];
  // A bounded item parser does not resolve XML entities, DTDs or external URLs.
  for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const field = (tag: string) => xmlText(item[1].match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "");
    const title = field("title");
    const url = canonicalStoryUrl(field("link"));
    const timestamp = Date.parse(field("pubDate") || field("dc:date"));
    if (title.length < 12 || title.length > 300 || !isNewsPublisher(url) || !(feed.articleHosts as readonly string[]).includes(sourceHost(url)) ||
      !Number.isFinite(timestamp) || timestamp > now + 60_000 || now - timestamp > MAX_SOURCE_AGE_MS) continue;
    const photoCandidate = [...item[1].matchAll(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*\burl\s*=\s*["']([^"']+)["'][^>]*>/gi)]
      .some(match => Boolean(normalizePartnerImageUrl(xmlText(match[1]), url)));
    leads.push({ publisher: feed.publisher, title, url, publishedAt: new Date(timestamp).toISOString(), photoCandidate });
    if (leads.length >= 100) break;
  }
  return leads;
}

export function selectNewsDiscoveryLeads(discovery: NewsFeedDiscovery, existing: NewsArticle[], now = Date.now()): NewsDiscoveryLead[] {
  const seen = new Set<string>();
  const candidates = discovery.leads.filter(lead => {
    const timestamp = Date.parse(lead.publishedAt);
    const url = canonicalStoryUrl(lead.url);
    if (!url || seen.has(url) || !isNewsPublisher(lead.url) || timestamp > now + 60_000 || !Number.isFinite(timestamp) || now - timestamp > MAX_SOURCE_AGE_MS) return false;
    seen.add(url);
    return !findDuplicateStory({ title: lead.title, body: [], sources: [{ id: "discovery", kind: "media", title: lead.title, publisher: lead.publisher, url: lead.url, publishedAt: lead.publishedAt }] }, existing);
  }).toSorted((a, b) => Number(b.photoCandidate) - Number(a.photoCandidate) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const groups = NEWS_SOURCES.map(source => candidates.filter(lead => sourceHost(lead.url) === source.host || (source.id === "bbc" && sourceHost(lead.url) === "bbc.co.uk")));
  const selected: NewsDiscoveryLead[] = [];
  // Round-robin publishers so one prolific feed cannot consume the whole prompt.
  for (let round = 0; round < 12 && selected.length < 60; round++) {
    for (const group of groups) {
      let lead: NewsDiscoveryLead | undefined;
      while ((lead = group.shift()) && isDuplicateTitle(lead.title, selected)) { /* Skip syndicated headline duplicates. */ }
      if (lead) selected.push(lead);
      if (selected.length === 60) break;
    }
  }
  return selected;
}

export async function collectNewsFeedDiscovery(fetcher: typeof fetch = fetch, now = Date.now()): Promise<NewsFeedDiscovery> {
  const feeds: NewsFeedDiscovery["feeds"] = [];
  const leads: NewsDiscoveryLead[] = [];
  for (let offset = 0; offset < NEWS_DISCOVERY_FEEDS.length; offset += 3) {
    const results = await Promise.all(NEWS_DISCOVERY_FEEDS.slice(offset, offset + 3).map(async feed => {
      try {
        const response = await fetcher(feed.url, { redirect: "error", signal: AbortSignal.timeout(6_000), headers: { Accept: "application/rss+xml,application/xml,text/xml", "User-Agent": "OddsFront/1.0 (+https://oddsfront.com/news)" } });
        if (!response.ok || !/xml/i.test(response.headers.get("content-type") ?? "") || Number(response.headers.get("content-length") ?? 0) > MAX_FEED_BYTES || !response.body) throw new Error("Feed unavailable");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_FEED_BYTES) { await reader.cancel(); throw new Error("Feed too large"); }
          chunks.push(value);
        }
        const entries = parseNewsDiscoveryFeed(Buffer.concat(chunks).toString("utf8"), feed, now);
        return { feed: { publisher: feed.publisher, url: feed.url, status: "available" as const, candidates: entries.length }, entries };
      } catch {
        return { feed: { publisher: feed.publisher, url: feed.url, status: "unavailable" as const, candidates: 0 }, entries: [] };
      }
    }));
    for (const result of results) { feeds.push(result.feed); leads.push(...result.entries); }
  }
  return { collectedAt: new Date(now).toISOString(), feeds, leads };
}
