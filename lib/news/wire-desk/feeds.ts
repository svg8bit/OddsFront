// Lead sources and fetch policy of the website wire desk. Feeds supply
// headlines (and, for a few outlets, full text inside the feed); article pages
// are fetched only from the outlets listed in FETCHABLE_HOSTS, which answered
// plain server-side requests with full text when this list was verified
// (2026-10-25). Paywalled outlets and outlets that refuse automated reads are
// coverage signals only: their pages are never requested.
import { HOT_DESK_FEEDS, type HotDeskFeed } from "../hot-desk/headlines.ts";

export type WireFeed = HotDeskFeed & {
  /** Google News search results for one wire service: leads only, never top stories. */
  wire?: boolean;
  /** The feed carries the full article in content:encoded. */
  fullText?: boolean;
};

const googleNewsSearch = (query: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

export const WIRE_DESK_FEEDS: readonly WireFeed[] = [
  ...HOT_DESK_FEEDS,
  { publisher: "BBC", url: "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml" },
  { publisher: "The Guardian", url: "https://www.theguardian.com/us-news/rss" },
  { publisher: "Euronews", url: "https://www.euronews.com/rss?level=theme&name=news" },
  { publisher: "CBS News", url: "https://www.cbsnews.com/latest/rss/world" },
  { publisher: "CBS News", url: "https://www.cbsnews.com/latest/rss/politics" },
  { publisher: "ABC News", url: "https://abcnews.go.com/abcnews/internationalheadlines" },
  { publisher: "ABC News", url: "https://abcnews.go.com/abcnews/politicsheadlines" },
  { publisher: "Fox News", url: "https://moxie.foxnews.com/google-publisher/world.xml", fullText: true },
  { publisher: "Fox News", url: "https://moxie.foxnews.com/google-publisher/politics.xml", fullText: true },
  { publisher: "Axios", url: "https://api.axios.com/feed/", fullText: true },
  { publisher: "Politico", url: "https://rss.politico.com/politics-news.xml", fullText: true },
  { publisher: "Iran International", url: "https://www.iranintl.com/en/feed" },
  { publisher: "Al-Monitor", url: "https://www.al-monitor.com/rss" },
  { publisher: "Ukrainska Pravda", url: "https://www.pravda.com.ua/eng/rss/" },
  // The wires themselves block automated reads; Google News surfaces their
  // headlines within minutes. They mark a story as real and early, nothing more.
  { publisher: "Google News", url: googleNewsSearch("site:apnews.com when:1h"), aggregator: true, wire: true },
  { publisher: "Google News", url: googleNewsSearch("site:reuters.com when:1h"), aggregator: true, wire: true },
];

/** Outlets whose article pages may be fetched for their text (verified server-side, no paywall). */
export const FETCHABLE_HOSTS = [
  "bbc.com", "bbc.co.uk", "theguardian.com", "aljazeera.com", "npr.org", "dw.com", "kyivindependent.com",
  "cnbc.com", "foxnews.com", "cbsnews.com", "abcnews.go.com", "euronews.com", "iranintl.com", "al-monitor.com",
  "pravda.com.ua", "meduza.io",
] as const;

/** Paywalled or automation-refusing outlets: never requested, even when a feed links them. */
export const NEVER_FETCH_HOSTS = [
  "nytimes.com", "wsj.com", "ft.com", "bloomberg.com", "economist.com", "washingtonpost.com", "thetimes.co.uk", "telegraph.co.uk",
  "reuters.com", "apnews.com", "france24.com", "thehill.com", "news.sky.com", "politico.com", "axios.com", "timesofisrael.com",
  "news.google.com",
] as const;

export function urlHost(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.hostname.toLowerCase().replace(/^www\./, "") : "";
  } catch { return ""; }
}

const TRACKING_PARAMETER = /^(?:utm_\w+|traffic_source|at_\w+|cmpid|cmp|ns_\w+|ito|xtor|sr_share|fbclid|gclid|ref|taid|smid|mc_cid|mc_eid|ocid|soc_src|soc_trk|intcmp|rss)$/i;

/** An article link without tracking parameters or fragment (robots.txt rules often refuse tracked URLs). */
export function cleanArticleUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key);
    url.hash = "";
    return url.toString();
  } catch { return value; }
}

const matchesHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** True when the article page at `url` may be requested for its text. */
export function isFetchableArticleUrl(url: string) {
  const host = urlHost(url);
  if (!host || NEVER_FETCH_HOSTS.some(domain => matchesHost(host, domain))) return false;
  if (!FETCHABLE_HOSTS.some(domain => matchesHost(host, domain))) return false;
  // Live blogs, video and audio pages carry no single article to rewrite.
  return !/\/(?:live|liveblog|video|videos|audio|podcasts?|av|programmes|sounds|gallery|pictures|in-pictures)(?:\/|-|$)/i.test(new URL(url).pathname);
}

const OUTLET_ALIASES: Readonly<Record<string, string>> = {
  "ap news": "AP", "the associated press": "AP", "associated press": "AP", ap: "AP",
  "reuters": "Reuters", "bbc news": "BBC", bbc: "BBC", "the guardian": "The Guardian", guardian: "The Guardian",
  "the new york times": "The New York Times", "new york times": "The New York Times", "nytimes.com": "The New York Times",
  "cnn": "CNN", "fox news": "Fox News", "cbs news": "CBS News", "abc news": "ABC News", "nbc news": "NBC News",
  "al jazeera": "Al Jazeera", "al jazeera english": "Al Jazeera", "politico": "Politico", "axios": "Axios",
  "the washington post": "The Washington Post", "washington post": "The Washington Post", "the wall street journal": "The Wall Street Journal",
  "wsj": "The Wall Street Journal", "bloomberg": "Bloomberg", "bloomberg.com": "Bloomberg", "npr": "NPR", "dw": "DW", "dw.com": "DW",
};

/** One name per outlet, so "AP News" and "The Associated Press" count once. */
export function normalizeOutlet(name: string) {
  const key = name.trim().toLowerCase();
  return OUTLET_ALIASES[key] ?? name.trim();
}

export const WIRE_OUTLETS = new Set(["AP", "Reuters"]);
