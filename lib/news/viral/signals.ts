// Virality signals for the news desks: what the world is talking about right now, beyond how many
// outlets carry a story. Three free sources, all read server-side and all optional (a failed source
// just scores zero): Reddit's hot r/worldnews and r/news lists, Google Trends' trending US searches,
// and GDELT's global article volume for a story's key names (a spike against the past day).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { headlineTokens, similarTokens, xmlPlainText, type HeadlineCluster } from "../hot-desk/headlines.ts";

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36";
const REDDIT_FEEDS = ["https://www.reddit.com/r/worldnews/hot/.rss?limit=30", "https://www.reddit.com/r/news/hot/.rss?limit=30"];
const TRENDS_FEED = "https://trends.google.com/trending/rss?geo=US";
const GDELT_TIMELINE = "https://api.gdeltproject.org/api/v2/doc/doc";

export type RedditItem = { title: string; rank: number; tokens: string[] };
export type TrendItem = { query: string; traffic: number; newsTitles: string[]; tokens: string[] };
export type TrendSignals = { reddit: RedditItem[]; trends: TrendItem[] };
export type ViralStory = Pick<HeadlineCluster, "title" | "titles" | "coverage" | "topStory" | "fingerprint"> & { members?: readonly { publishedAt: string }[]; wire?: boolean };
export type ViralScore = { score: number; signals: string[] };

/** Reddit Atom feed entries in hot order (pinned live and discussion threads included: they mark the biggest stories). */
export function parseRedditFeed(xml: string): RedditItem[] {
  return [...xml.matchAll(/<entry\b[\s\S]*?<title\b[^>]*>([\s\S]*?)<\/title>[\s\S]*?<\/entry>/gi)].map((match, index) => {
    const title = xmlPlainText(match[1]!).replace(/^\/r\/\w+\s+(?:live|discussion)\s+thread:\s*/i, "").replace(/\s*\((?:thread|part)\s*#?\d+\)\s*$/i, "");
    return { title, rank: index + 1, tokens: headlineTokens(title) };
  }).filter(item => item.tokens.length >= 2);
}

/** "2000+" → 2000, "50K+" → 50000, "1M+" → 1000000. */
export function parseTraffic(value: string) {
  const match = value.replace(/[,\s]/g, "").match(/^(\d+(?:\.\d+)?)([KM]?)/i);
  if (!match) return 0;
  return Math.round(Number(match[1]) * (match[2]?.toUpperCase() === "M" ? 1_000_000 : match[2]?.toUpperCase() === "K" ? 1_000 : 1));
}

export function parseTrendsFeed(xml: string): TrendItem[] {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(match => {
    const body = match[1]!;
    const query = xmlPlainText(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const traffic = parseTraffic(xmlPlainText(body.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/i)?.[1] ?? ""));
    const newsTitles = [...body.matchAll(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/gi)].map(item => xmlPlainText(item[1]!)).filter(Boolean).slice(0, 4);
    return { query, traffic, newsTitles, tokens: headlineTokens(query) };
  }).filter(item => item.query && item.tokens.length);
}

async function text(url: string, request: typeof fetch) {
  const response = await request(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
  return response.text();
}

/** Reddit and Google Trends lists; either may come back empty. */
export async function fetchTrendSignals(request: typeof fetch = fetch): Promise<TrendSignals> {
  const [reddit, trends] = await Promise.all([
    Promise.all(REDDIT_FEEDS.map(url => text(url, request).then(parseRedditFeed).catch(() => [] as RedditItem[]))),
    text(TRENDS_FEED, request).then(parseTrendsFeed).catch(() => [] as TrendItem[]),
  ]);
  // One list: an item keeps its best rank across both subreddits.
  const merged = new Map<string, RedditItem>();
  for (const item of reddit.flat()) if (!merged.has(item.title) || merged.get(item.title)!.rank > item.rank) merged.set(item.title, item);
  return { reddit: [...merged.values()].toSorted((a, b) => a.rank - b.rank), trends };
}

const isKeyName = (token: string) => [...KEY_NAMES].some(name => similarTokens(token, name));

/**
 * Same story in two token lists: shared stems covering a third of the shorter list, and either three
 * of them or two that include a key name ("election" + "vote" alone is not one story).
 */
export function tokensMatch(left: readonly string[], right: readonly string[]) {
  const shared = left.filter(token => right.some(other => similarTokens(token, other)));
  if (shared.length < 2 || shared.length / Math.max(1, Math.min(left.length, right.length)) < 0.34) return false;
  return shared.length >= 3 || shared.some(isKeyName);
}

const storyTokens = (story: ViralStory) => [...new Set([...story.fingerprint, ...story.titles.slice(0, 3).flatMap(title => headlineTokens(title))])];

/** True when a headline (e.g. a published site article) reports this story. */
export function storyMatchesTitle(story: ViralStory, title: string) {
  return tokensMatch(storyTokens(story), headlineTokens(title));
}

/** The story's best Reddit rank, or null. */
export function redditRank(story: ViralStory, reddit: readonly RedditItem[]) {
  const tokens = storyTokens(story);
  return reddit.find(item => tokensMatch(tokens, item.tokens))?.rank ?? null;
}

/** The trending search behind the story (every query word in the story, or a trend headline about it). */
export function trendMatch(story: ViralStory, trends: readonly TrendItem[]) {
  const tokens = storyTokens(story);
  return trends.filter(trend => trend.tokens.every(token => tokens.some(other => similarTokens(token, other))) || trend.newsTitles.some(title => tokensMatch(tokens, headlineTokens(title))))
    .toSorted((a, b) => b.traffic - a.traffic)[0] ?? null;
}

// Names that make a GDELT search specific; checked before any other word of the headline.
const KEY_NAMES = new Set([
  "iran", "israel", "gaza", "hamas", "hezbollah", "houthi", "yemen", "lebanon", "syria", "iraq", "hormuz", "tehran", "netanyahu", "khamenei", "saudi", "riyadh", "qatar", "oman",
  "ukraine", "russia", "putin", "zelensky", "zelenskyy", "kremlin", "moscow", "kyiv", "nato", "poland", "belarus", "baltic", "starlink", "musk",
  "china", "taiwan", "beijing", "korea", "pyongyang", "japan", "philippines", "india", "pakistan", "venezuela", "maduro", "cuba", "mexico", "greenland",
  "trump", "vance", "pentagon", "opec", "brent", "lula", "bolsonaro", "france", "germany", "britain", "turkey", "egypt", "sudan",
]);

/** Two key names for a GDELT search: known names first, then other proper nouns, then the longest stems. */
export function gdeltTerms(title: string) {
  const stems = headlineTokens(title);
  const known = stems.filter(isKeyName);
  const words = title.split(/\s+/).map(word => word.replace(/['’]s$/i, "").replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""));
  // Proper nouns: capitalised words that are not the first word and not stop words (headlineTokens drops those).
  const titleCase = words.filter(word => /^\p{Lu}/u.test(word)).length > words.length * 0.6;
  const names = titleCase ? [] : words.slice(1).filter(word => /^\p{Lu}[\p{L}-]{2,}$/u.test(word) && headlineTokens(word).length).map(word => word.toLowerCase());
  const longest = stems.toSorted((a, b) => b.length - a.length);
  return [...new Set([...known, ...names, ...longest])].slice(0, 2);
}

/** Recent (last 2 h) GDELT volume against the median of the rest of the day; null when unknown. */
export function spikeRatio(values: readonly number[]) {
  if (values.length < 16) return null;
  const recent = values.slice(-8);
  const before = values.slice(0, -8).toSorted((a, b) => a - b);
  const median = before[Math.floor(before.length / 2)]!;
  const level = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  if (level <= 0) return 0;
  return Math.min(10, median > 0 ? level / median : 10);
}

export type GdeltOptions = { request?: typeof fetch; stateFile?: string | null; now?: () => number };
const GDELT_SPACING_MS = 6_000;
const GDELT_BACKOFF_MS = 30 * 60_000;
// Without a state file (tests, one-off runs) the spacing holds within this process.
let memoryState = { lastAt: 0, blockedUntil: 0 };

async function gdeltState(file: string): Promise<{ lastAt: number; blockedUntil: number }> {
  try { const value = JSON.parse(await readFile(file, "utf8")); return { lastAt: Number(value.lastAt) || 0, blockedUntil: Number(value.blockedUntil) || 0 }; } catch { return { lastAt: 0, blockedUntil: 0 }; }
}

async function saveGdeltState(file: string, value: { lastAt: number; blockedUntil: number }) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(`${file}.${process.pid}.tmp`, JSON.stringify(value), { mode: 0o600 });
  await rename(`${file}.${process.pid}.tmp`, file);
}

/**
 * GDELT spike for two key names. With a state file the desks share one request slot (one call per six
 * seconds across processes) and stop asking for half an hour after GDELT refuses a request.
 */
export async function gdeltSpike(terms: readonly string[], { request = fetch, stateFile = null, now = Date.now }: GdeltOptions = {}): Promise<number | null> {
  if (terms.length < 2) return null;
  let state = stateFile ? await gdeltState(stateFile) : memoryState;
  if (state.blockedUntil > now()) return null;
  const wait = state.lastAt + GDELT_SPACING_MS - now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, Math.min(wait, GDELT_SPACING_MS)));
  state = { ...state, lastAt: now() };
  const query = terms.map(term => (/\s/.test(term) ? `"${term}"` : term)).join(" ");
  try {
    const url = `${GDELT_TIMELINE}?query=${encodeURIComponent(query)}&mode=timelinevol&timespan=24h&format=json`;
    const response = await request(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
    const body = response.ok ? await response.text() : "";
    if (!response.ok || !body.trimStart().startsWith("{")) {
      // "Please limit requests…" comes back as plain text with status 200.
      if (/limit requests/i.test(body) || response.status === 429) state = { ...state, blockedUntil: now() + GDELT_BACKOFF_MS };
      return null;
    }
    const parsed = JSON.parse(body) as { timeline?: { data?: { value?: number }[] }[] };
    return spikeRatio((parsed.timeline?.[0]?.data ?? []).map(point => Number(point.value) || 0));
  } catch { return null; }
  finally { if (stateFile) await saveGdeltState(stateFile, state).catch(() => {}); else memoryState = state; }
}

/**
 * 0–100: outlets and freshness from the feeds, plus Reddit, Google Trends and a GDELT spike.
 * The signals are short English notes for the editor's prompt.
 */
export function viralScore(story: ViralStory, signals: TrendSignals, gdelt: number | null = null, now = Date.now()): ViralScore {
  const notes: string[] = [];
  let score = Math.min(story.coverage, 8) / 8 * 30;
  if (story.coverage >= 3) notes.push(`${story.coverage} outlets`);
  const lastHour = (story.members ?? []).filter(member => now - Date.parse(member.publishedAt) <= 90 * 60_000).length;
  score += Math.min(lastHour, 5) * 2;
  if (lastHour >= 3) notes.push(`${lastHour} reports in the last 90 min`);
  if (story.topStory) { score += 10; notes.push("Google News top story"); }
  if (story.wire) score += 5;
  const rank = redditRank(story, signals.reddit);
  if (rank !== null) { score += 20 * Math.max(0.2, 1 - (rank - 1) / 30); notes.push(`Reddit hot #${rank}`); }
  const trend = trendMatch(story, signals.trends);
  if (trend) { score += trend.traffic >= 20_000 ? 20 : 12; notes.push(`trending Google search "${trend.query}" (${trend.traffic.toLocaleString("en-US")}+)`); }
  if (gdelt !== null && gdelt >= 1.5) { score += gdelt >= 4 ? 15 : gdelt >= 2.5 ? 10 : 5; notes.push(`global coverage ×${gdelt.toFixed(1)} vs the past day`); }
  return { score: Math.round(Math.min(100, score)), signals: notes };
}

/**
 * Scores for the given stories (by index). Only the `gdeltLimit` stories that already score highest
 * get a GDELT spike lookup (GDELT allows one request per five seconds).
 */
export async function scoreStories(stories: readonly ViralStory[], signals: TrendSignals, { gdeltLimit = 4, now = Date.now(), request = fetch as typeof fetch, stateFile = null as string | null, clock = Date.now } = {}): Promise<ViralScore[]> {
  const base = stories.map(story => viralScore(story, signals, null, now));
  const order = base.map((value, index) => ({ index, score: value.score })).toSorted((a, b) => b.score - a.score).slice(0, gdeltLimit);
  const spikes = new Map<number, number | null>();
  for (const { index } of order) spikes.set(index, await gdeltSpike(gdeltTerms(stories[index]!.title), { request, stateFile, now: clock }));
  return stories.map((story, index) => (spikes.get(index) != null ? viralScore(story, signals, spikes.get(index)!, now) : base[index]!));
}
