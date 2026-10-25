// Breaking-news leads for the Telegram hot desk. Public RSS feeds supply
// headlines and summaries only; the editor never fetches article pages.

export const HOT_DESK_FEEDS = [
  { publisher: "BBC", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { publisher: "The Guardian", url: "https://www.theguardian.com/world/rss" },
  { publisher: "The New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { publisher: "The New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml" },
  { publisher: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { publisher: "NPR", url: "https://feeds.npr.org/1004/rss.xml" },
  { publisher: "France 24", url: "https://www.france24.com/en/rss" },
  { publisher: "DW", url: "https://rss.dw.com/rdf/rss-en-world" },
  { publisher: "The Hill", url: "https://thehill.com/news/feed/" },
  { publisher: "The Kyiv Independent", url: "https://kyivindependent.com/news-archive/rss/" },
  { publisher: "CNBC", url: "https://www.cnbc.com/id/100727362/device/rss/rss.html" },
  { publisher: "Sky News", url: "https://feeds.skynews.com/feeds/rss/world.xml" },
  { publisher: "Meduza", url: "https://meduza.io/rss/en/all" },
  // Google News top stories carry the original outlet in <source>; they are the
  // best single signal of what the whole press is leading with.
  { publisher: "Google News", url: "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en", aggregator: true },
  { publisher: "Google News", url: "https://news.google.com/rss/headlines/section/topic/NATION?hl=en-US&gl=US&ceid=US:en", aggregator: true },
] as const;

export type HotDeskFeed = { publisher: string; url: string; aggregator?: boolean };
export type Headline = { outlet: string; title: string; description: string; url: string; publishedAt: string; topStory: boolean };
export type HeadlineCluster = {
  id: string;
  title: string;
  titles: string[];
  description: string;
  outlets: string[];
  coverage: number;
  topStory: boolean;
  latestAt: string;
  fingerprint: string[];
};

const MAX_FEED_BYTES = 2_000_000;
const MAX_ITEMS_PER_FEED = 80;

function decodeEntities(value: string) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[\da-f]+);/gi, entity => {
    const known: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
    if (known[entity.toLowerCase()]) return known[entity.toLowerCase()];
    const hex = entity.toLowerCase().startsWith("&#x");
    const code = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

/** Plain text of an RSS field: CDATA unwrapped, markup removed, entities decoded once. */
export function xmlPlainText(value: string) {
  const unwrapped = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Descriptions often carry escaped HTML; decode, strip tags, then tidy spacing.
  return decodeEntities(decodeEntities(unwrapped).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Headlines of one RSS 2.0 or RSS 1.0 (RDF) feed published within `maxAgeMs`. */
export function parseHeadlines(xml: string, feed: HotDeskFeed, now = Date.now(), maxAgeMs = 8 * 60 * 60_000): Headline[] {
  const headlines: Headline[] = [];
  // A bounded item parser: no DTDs, external entities or URLs are resolved.
  for (const [index, item] of [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].entries()) {
    if (headlines.length >= MAX_ITEMS_PER_FEED) break;
    const raw = (tag: string) => item[1].match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "";
    let title = xmlPlainText(raw("title"));
    let outlet = feed.publisher;
    if (feed.aggregator) {
      const source = xmlPlainText(raw("source"));
      if (!source) continue;
      outlet = source;
      // Google appends " - Outlet" to every title.
      if (title.endsWith(` - ${source}`)) title = title.slice(0, -source.length - 3).trim();
    }
    const timestamp = Date.parse(xmlPlainText(raw("pubDate")) || xmlPlainText(raw("dc:date")));
    const url = xmlPlainText(raw("link")) || (item[0].match(/rdf:about="([^"]+)"/)?.[1] ?? "");
    if (title.length < 12 || title.length > 300 || !/^https:\/\//.test(url) || !Number.isFinite(timestamp) || timestamp > now + 5 * 60_000 || now - timestamp > maxAgeMs) continue;
    // Google's description is a list of related links, not a summary.
    const description = feed.aggregator ? "" : xmlPlainText(raw("description")).slice(0, 400);
    headlines.push({ outlet, title, description: description === title ? "" : description, url, publishedAt: new Date(timestamp).toISOString(), topStory: Boolean(feed.aggregator) && index < 20 });
  }
  return headlines;
}

async function readBounded(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FEED_BYTES) { await reader.cancel(); break; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type HeadlineCollection = { collectedAt: string; feeds: { url: string; status: "ok" | "failed"; headlines: number }[]; headlines: Headline[] };

export async function collectHeadlines(feeds: readonly HotDeskFeed[] = HOT_DESK_FEEDS, now = Date.now(), maxAgeMs?: number): Promise<HeadlineCollection> {
  const results = await Promise.all(feeds.map(async feed => {
    try {
      const response = await fetch(feed.url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; OddsFrontHotDesk/1.0; +https://oddsfront.com)", Accept: "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) { await response.body?.cancel(); return { feed, headlines: null }; }
      return { feed, headlines: parseHeadlines(await readBounded(response), feed, now, maxAgeMs) };
    } catch { return { feed, headlines: null }; }
  }));
  return {
    collectedAt: new Date(now).toISOString(),
    feeds: results.map(({ feed, headlines }) => ({ url: feed.url, status: headlines ? "ok" : "failed", headlines: headlines?.length ?? 0 })),
    headlines: results.flatMap(result => result.headlines ?? []),
  };
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "after", "over", "into", "amid", "about", "says", "said", "say", "will", "would", "could", "than",
  "what", "when", "where", "who", "why", "how", "its", "his", "her", "their", "they", "them", "are", "was", "were", "has", "have", "had", "not", "but",
  "new", "more", "most", "out", "off", "all", "can", "may", "now", "just", "being", "been", "also", "some", "other", "first", "last", "year", "years",
  "live", "latest", "update", "updates", "news", "video", "watch", "today", "week", "day", "days", "inside", "here", "there", "between", "against",
  "under", "before", "while", "during", "make", "makes", "made", "take", "takes", "set", "sets", "get", "gets", "one", "two", "three", "back", "down",
]);

/** Distinctive lowercase word stems of a headline (plural "s" dropped). */
export function headlineTokens(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/['’]s\b/g, "").split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length >= 3 && !STOP_WORDS.has(word) && !/^\d+$/.test(word))
    .map(word => (word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word)))];
}

/** Same word stem: brazil/brazilian, vote/voter, ukraine/ukrainian, china/chinese, president/presidential. */
export function similarTokens(left: string, right: string) {
  if (left === right) return true;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (short.length < 4 || long.length - short.length > 5) return false;
  if (long.startsWith(short)) return true;
  // A final vowel may change before a suffix (ukraine → ukrainian), never in same-length words (police/policy).
  return long.length > short.length && /[aey]$/.test(short) && long.startsWith(short.slice(0, -1));
}

/** Map every token of a batch to one representative of its stem (the shortest). */
function canonicalTokens(lists: readonly string[][]) {
  const canonical = new Map<string, string>();
  const representatives: string[] = [];
  for (const token of [...new Set(lists.flat())].toSorted((a, b) => a.length - b.length || a.localeCompare(b))) {
    const representative = representatives.find(candidate => similarTokens(candidate, token));
    if (representative) canonical.set(token, representative);
    else { representatives.push(token); canonical.set(token, token); }
  }
  return lists.map(tokens => [...new Set(tokens.map(token => canonical.get(token) ?? token))]);
}

/** Weighted overlap of two token sets; rare shared words count more. */
export function tokenSimilarity(left: readonly string[], right: readonly string[], idf: (token: string) => number = () => 1) {
  const shared = left.filter(token => right.includes(token));
  if (shared.length < 2) return 0;
  const weight = (tokens: readonly string[]) => tokens.reduce((sum, token) => sum + idf(token), 0);
  return weight(shared) / Math.max(1e-9, Math.min(weight(left), weight(right)));
}

/** Greedy clustering of the same story told by several outlets. */
export function clusterHeadlines(headlines: readonly Headline[], threshold = 0.5): HeadlineCluster[] {
  const canonical = canonicalTokens(headlines.map(headline => headlineTokens(headline.title)));
  const tokenized = headlines.map((headline, index) => ({ headline, tokens: canonical[index]! })).filter(item => item.tokens.length >= 2);
  const frequency = new Map<string, number>();
  for (const { tokens } of tokenized) for (const token of tokens) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  const idf = (token: string) => Math.log(1 + tokenized.length / (frequency.get(token) ?? 1));
  // Top stories and widely covered wordings seed clusters first.
  tokenized.sort((a, b) => Number(b.headline.topStory) - Number(a.headline.topStory) || Date.parse(b.headline.publishedAt) - Date.parse(a.headline.publishedAt));
  const groups: { items: typeof tokenized; tokens: string[] }[] = [];
  for (const item of tokenized) {
    let best: (typeof groups)[number] | null = null;
    let bestScore = 0;
    for (const group of groups) {
      const score = Math.max(...group.items.map(member => tokenSimilarity(item.tokens, member.tokens, idf)));
      if (score > bestScore) { best = group; bestScore = score; }
    }
    if (best && bestScore >= threshold) { best.items.push(item); best.tokens = [...new Set([...best.tokens, ...item.tokens])]; }
    else groups.push({ items: [item], tokens: [...item.tokens] });
  }
  const clusters = groups.map(group => {
    const outlets = [...new Set(group.items.map(item => item.headline.outlet))];
    const counts = new Map<string, number>();
    for (const item of group.items) for (const token of item.tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    const lead = group.items.find(item => item.headline.description) ?? group.items[0]!;
    return {
      title: group.items[0]!.headline.title,
      titles: [...new Set(group.items.map(item => item.headline.title))].slice(0, 4),
      description: lead.headline.description.slice(0, 300),
      outlets,
      coverage: outlets.length,
      topStory: group.items.some(item => item.headline.topStory),
      latestAt: group.items.map(item => item.headline.publishedAt).toSorted().at(-1)!,
      fingerprint: [...counts.entries()].toSorted((a, b) => b[1] * idf(b[0]) - a[1] * idf(a[0])).slice(0, 10).map(([token]) => token),
    };
  });
  return clusters
    .toSorted((a, b) => b.coverage - a.coverage || Number(b.topStory) - Number(a.topStory) || Date.parse(b.latestAt) - Date.parse(a.latestAt))
    .map((cluster, index) => ({ id: `s${index + 1}`, ...cluster }));
}

/**
 * A manual run's topic: keyword groups joined by "+", alternatives by "," — "iran,tehran+strike,war"
 * matches text containing (iran OR tehran) AND (strike OR war), case-insensitively. Plain words, no
 * regular expressions, so an operator's argument can never become a pattern.
 */
export function topicMatcher(spec: string): ((text: string) => boolean) | null {
  const groups = spec.toLowerCase().split("+").map(group => group.split(",").map(word => word.trim()).filter(Boolean)).filter(group => group.length);
  if (!groups.length) return null;
  return text => {
    const haystack = text.toLowerCase();
    return groups.every(group => group.some(word => haystack.includes(word)));
  };
}

/**
 * A manual "post on this topic" run (--topic=WORDS): every cluster whose headlines or summary match is
 * one story told by several outlets (word clustering splits differently worded reports of it), so they
 * merge into a single story whose coverage counts all of their outlets. Null when nothing matches.
 */
export function mergeTopicClusters(clusters: readonly HeadlineCluster[], topic: (text: string) => boolean): HeadlineCluster | null {
  const matching = clusters.filter(cluster => topic([cluster.title, ...cluster.titles, cluster.description].join(" ")));
  if (!matching.length) return null;
  const ordered = matching.toSorted((a, b) => b.coverage - a.coverage || Date.parse(b.latestAt) - Date.parse(a.latestAt));
  const outlets = [...new Set(ordered.flatMap(cluster => cluster.outlets))];
  return {
    id: "t1",
    title: ordered[0]!.title,
    titles: [...new Set(ordered.flatMap(cluster => cluster.titles))].slice(0, 10),
    description: ordered.map(cluster => cluster.description).filter(Boolean).join(" ").slice(0, 600),
    outlets,
    coverage: outlets.length,
    topStory: ordered.some(cluster => cluster.topStory),
    latestAt: ordered.map(cluster => cluster.latestAt).toSorted().at(-1)!,
    fingerprint: [...new Set(ordered.flatMap(cluster => cluster.fingerprint))].slice(0, 12),
  };
}

/** True when two story fingerprints describe the same development. */
export function sameStory(left: readonly string[], right: readonly string[]) {
  const shared = left.filter(token => right.some(other => similarTokens(token, other))).length;
  return shared >= 3 && shared / Math.max(1, Math.min(left.length, right.length)) >= 0.5;
}
