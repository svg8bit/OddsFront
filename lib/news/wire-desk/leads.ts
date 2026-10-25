// Leads for the website wire desk: public feeds → headlines → stories.
// Only feed text is read here; article pages are fetched later, for the few
// stories the editor picks (see source-text.ts).
import { clusterHeadlines, headlineTokens, parseHeadlines, sameStory, xmlPlainText, type Headline, type HeadlineCluster } from "../hot-desk/headlines.ts";
import { cleanArticleUrl, normalizeOutlet, WIRE_DESK_FEEDS, WIRE_OUTLETS, type WireFeed } from "./feeds.ts";

export const WIRE_DESK_USER_AGENT = "Mozilla/5.0 (compatible; OddsFrontNewsDesk/1.0; +https://oddsfront.com/news/about)";
const MAX_FEED_BYTES = 2_500_000;
const MAX_FEED_TEXT_CHARS = 14_000;

export type WireHeadline = Headline & { wire: boolean; feedText?: string };
export type WireCollection = { collectedAt: string; feeds: { url: string; status: "ok" | "failed"; headlines: number }[]; headlines: WireHeadline[] };

/** A response body read up to `limit` bytes; longer bodies are cut, never buffered whole. */
export async function readBoundedText(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); break; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Full article texts that a feed carries in content:encoded, by item link. */
export function feedFullTexts(xml: string): Map<string, string> {
  const texts = new Map<string, string>();
  for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const link = xmlPlainText(item[1].match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "");
    const encoded = item[1].match(/<content:encoded\b[^>]*>([\s\S]*?)<\/content:encoded>/i)?.[1];
    if (!link || !encoded) continue;
    // Paragraph breaks survive as blank lines before the markup is removed.
    const paragraphs = encoded.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").split(/<\/p>|<br\s*\/?>\s*<br\s*\/?>/i)
      .map(part => xmlPlainText(part)).filter(part => part.length >= 40);
    const text = paragraphs.join("\n\n").slice(0, MAX_FEED_TEXT_CHARS);
    if (text.length >= 1_200) texts.set(link, text);
  }
  return texts;
}

/** Headlines of one feed with normalized outlet names and, where carried, the full text. */
export function parseWireFeed(xml: string, feed: WireFeed, now: number, maxAgeMs: number): WireHeadline[] {
  const texts = feed.fullText ? feedFullTexts(xml) : new Map<string, string>();
  return parseHeadlines(xml, feed, now, maxAgeMs).map(headline => {
    const outlet = normalizeOutlet(headline.outlet);
    return {
      ...headline,
      url: feed.aggregator ? headline.url : cleanArticleUrl(headline.url),
      outlet,
      // Search results are not Google's top stories.
      topStory: feed.wire ? false : headline.topStory,
      wire: Boolean(feed.wire) || WIRE_OUTLETS.has(outlet),
      ...(texts.get(headline.url) ? { feedText: texts.get(headline.url) } : {}),
    };
  });
}

export async function collectWireHeadlines(feeds: readonly WireFeed[] = WIRE_DESK_FEEDS, now = Date.now(), maxAgeMs = 10 * 60 * 60_000): Promise<WireCollection> {
  const results = await Promise.all(feeds.map(async feed => {
    try {
      const response = await fetch(feed.url, { redirect: "follow", headers: { "User-Agent": WIRE_DESK_USER_AGENT, Accept: "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) { await response.body?.cancel(); return { feed, headlines: null }; }
      return { feed, headlines: parseWireFeed(await readBoundedText(response, MAX_FEED_BYTES), feed, now, maxAgeMs) };
    } catch { return { feed, headlines: null }; }
  }));
  // One link once: the BBC world and US feeds share stories.
  const seen = new Set<string>();
  const headlines: WireHeadline[] = [];
  for (const headline of results.flatMap(result => result.headlines ?? [])) {
    if (seen.has(headline.url)) continue;
    seen.add(headline.url);
    headlines.push(headline);
  }
  return {
    collectedAt: new Date(now).toISOString(),
    feeds: results.map(({ feed, headlines }) => ({ url: feed.url, status: headlines ? "ok" : "failed", headlines: headlines?.length ?? 0 })),
    headlines,
  };
}

export type WireStory = HeadlineCluster & { members: WireHeadline[]; wire: boolean; topical: number };

// The owner's topic map. A story that touches none of these words can still be
// picked by the editor; the lexicon only decides whether a new cycle is worth a call.
const TOPIC_LEXICON = [
  "iran", "israel", "gaza", "hamas", "hezbollah", "houthi", "yemen", "lebanon", "syria", "iraq", "hormuz", "tehran", "netanyahu", "khamenei",
  "oil", "crude", "opec", "tanker", "shipping", "brent", "gas", "pipeline", "refinery",
  "ukraine", "russia", "russian", "ukrainian", "putin", "zelensky", "kremlin", "moscow", "kyiv", "nato", "baltic", "poland", "belarus",
  "china", "chinese", "taiwan", "beijing", "xi", "korea", "pyongyang", "kim", "japan", "philippines",
  "nuclear", "missile", "missiles", "drone", "drones", "strike", "strikes", "airstrike", "troops", "military", "army", "navy", "pentagon",
  "war", "invasion", "offensive", "ceasefire", "truce", "blockade", "sanction", "sanctions", "tariff", "tariffs", "trade", "embargo",
  "trump", "vance", "white house", "congress", "senate", "house", "supreme court", "shutdown", "impeachment", "fed", "midterm", "midterms",
  "election", "coup", "junta", "president", "prime minister", "resigns", "ousted", "arrested", "venezuela", "maduro", "cuba", "india", "pakistan",
];
const LEXICON_TOKENS = new Set(TOPIC_LEXICON.flatMap(word => headlineTokens(word)));

/** How many owner-topic words the story's headlines carry (0 = probably off-topic). */
export function topicalScore(cluster: Pick<HeadlineCluster, "titles" | "description">) {
  const tokens = new Set(cluster.titles.flatMap(title => headlineTokens(title)));
  for (const token of headlineTokens(cluster.description)) tokens.add(token);
  return [...tokens].filter(token => LEXICON_TOKENS.has(token)).length;
}

export function wireStories(headlines: readonly WireHeadline[]): WireStory[] {
  return clusterHeadlines(headlines).map(cluster => {
    const members = cluster.members as WireHeadline[];
    return { ...cluster, members, wire: members.some(member => member.wire), topical: topicalScore(cluster) };
  });
}

export type ConsumedLead = { url: string; at: string };
export type WrittenStory = { at: string; title: string; fingerprint: string[] };

/**
 * Stories still open for writing: none of their links already fed an article,
 * and none repeats a story written in the last `memoryHours`.
 */
export function openStories(stories: readonly WireStory[], consumed: readonly ConsumedLead[], written: readonly WrittenStory[], now = Date.now(), memoryHours = 6) {
  const used = new Set(consumed.map(item => item.url));
  const recent = written.filter(item => now - Date.parse(item.at) <= memoryHours * 60 * 60_000);
  return stories.filter(story => {
    const usedShare = story.members.filter(member => used.has(member.url)).length / Math.max(1, story.members.length);
    return usedShare < 0.5 && !recent.some(item => sameStory(item.fingerprint, story.fingerprint));
  });
}

/** Stories worth a selection call now: on-topic, covered by two outlets or a wire, and not judged recently. */
export function storiesNeedingEvaluation(stories: readonly WireStory[], evaluated: readonly { at: string; fingerprint: string[] }[], now = Date.now(), reevaluateMinutes = 180, minCoverage = 2) {
  const recent = evaluated.filter(item => now - Date.parse(item.at) < reevaluateMinutes * 60_000);
  return stories.filter(story => story.topical > 0 && (story.coverage >= minCoverage || story.wire) && !recent.some(item => sameStory(item.fingerprint, story.fingerprint)));
}
