// Server-side reading of the source articles the writer works from. Only
// allowlisted, free outlets are requested (feeds.ts), robots.txt is honoured,
// responses are size- and time-bounded, and only the article text is kept.
import { xmlPlainText } from "../hot-desk/headlines.ts";
import { isFetchableArticleUrl, urlHost } from "./feeds.ts";
import { readBoundedText, WIRE_DESK_USER_AGENT, type WireHeadline } from "./leads.ts";

const MAX_HTML_BYTES = 3_000_000;
const MAX_SOURCE_CHARS = 8_000;
const MIN_SOURCE_CHARS = 900;
const ROBOTS_TOKEN = "oddsfrontnewsdesk";

export type SourceText = {
  id: string;
  outlet: string;
  url: string;
  title: string;
  publishedAt: string;
  text: string;
  /** "page" when read from the article page, "feed" when the feed carried the full text. */
  origin: "page" | "feed";
};

type RobotsRule = { allow: boolean; pattern: string };

/** The rules of the group that applies to us (our own token, else "*"). */
export function robotsRules(body: string, token = ROBOTS_TOKEN): RobotsRule[] {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!match) continue;
    const [, key, value] = match;
    const field = key!.toLowerCase();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value!.trim().toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      lastWasAgent = false;
      if (value!.trim()) current.rules.push({ allow: field === "allow", pattern: value!.trim() });
    } else lastWasAgent = false;
  }
  const own = groups.filter(group => group.agents.some(agent => agent !== "*" && token.includes(agent)));
  const chosen = own.length ? own : groups.filter(group => group.agents.includes("*"));
  return chosen.flatMap(group => group.rules);
}

function patternMatches(pattern: string, path: string) {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp(`^${body.split("*").map(part => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
  return regex.test(path);
}

/** Longest matching rule wins; Allow wins a tie; no rule means allowed. */
export function robotsAllows(rules: readonly RobotsRule[], pathWithQuery: string) {
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!patternMatches(rule.pattern, pathWithQuery)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return !best || best.allow;
}

const robotsCache = new Map<string, Promise<RobotsRule[] | null>>();

async function hostRobots(origin: string): Promise<RobotsRule[] | null> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;
  const load = (async () => {
    try {
      const response = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": WIRE_DESK_USER_AGENT }, signal: AbortSignal.timeout(6_000), redirect: "follow" });
      if (response.status >= 400 && response.status < 500) { await response.body?.cancel(); return []; }
      if (!response.ok) { await response.body?.cancel(); return null; }
      return robotsRules(await readBoundedText(response, 500_000));
    } catch { return null; }
  })();
  robotsCache.set(origin, load);
  return load;
}

const BOILERPLATE = /^(?:advertisement|sign up|subscribe|follow us|read more|related|more on this|click here|image (?:source|caption)|copyright|©|getty images|watch:|listen:|share this|download (?:the|our) app|this article (?:was|is)|you can (?:now )?listen|get (?:our|the) .*newsletter)/i;
const BOILERPLATE_ANYWHERE = /cookie|newsletter|all rights reserved|javascript|your browser|terms of (?:use|service)|privacy policy|\$\d+(?:\.\d+)?\s*\/\s*(?:week|month)|read everything they file|support (?:our|independent) journalism|become a (?:member|subscriber)/i;

function plain(html: string) {
  return xmlPlainText(html.replace(/<(script|style|noscript|svg|figure|figcaption|aside|nav|footer|form|button)\b[\s\S]*?<\/\1>/gi, " "));
}

type JsonLd = Record<string, unknown>;

function jsonLdObjects(html: string): JsonLd[] {
  const objects: JsonLd[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    objects.push(value as JsonLd);
    const graph = (value as JsonLd)["@graph"];
    if (graph) visit(graph);
  };
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1]!.trim())); } catch { /* Ignore malformed blocks. */ }
  }
  return objects;
}

const isArticleType = (value: unknown) => [value].flat().some(type => typeof type === "string" && /(?:News|Reportage|Analysis)?Article$|^BlogPosting$/i.test(type));

/** True when the page marks itself as paywalled. */
export function paywalled(html: string) {
  return jsonLdObjects(html).some(object => isArticleType(object["@type"]) && (object.isAccessibleForFree === false || String(object.isAccessibleForFree).toLowerCase() === "false"));
}

function paragraphsOf(region: string) {
  const seen = new Set<string>();
  const paragraphs: string[] = [];
  for (const match of region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = plain(match[1]!);
    if (text.length < 50 || BOILERPLATE.test(text) || (text.length < 220 && BOILERPLATE_ANYWHERE.test(text)) || seen.has(text)) continue;
    seen.add(text);
    paragraphs.push(text);
  }
  return paragraphs;
}

/** End index of the element opened at `start` (nesting-aware), or the document end. */
function elementEnd(html: string, start: number, tag: string) {
  const pattern = new RegExp(`<${tag}\\b|</${tag}\\s*>`, "gi");
  pattern.lastIndex = start + 1;
  let depth = 1;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[0][1] === "/" ? -1 : 1;
    if (depth === 0) return pattern.lastIndex;
  }
  return html.length;
}

/** `region` without nested elements of `tag` (related-story cards inside an article). */
function withoutNested(region: string, tag: string) {
  let result = region;
  const pattern = new RegExp(`<${tag}\\b`, "gi");
  for (let guard = 0; guard < 50; guard += 1) {
    pattern.lastIndex = 1;
    const match = pattern.exec(result);
    if (!match) break;
    result = result.slice(0, match.index) + result.slice(elementEnd(result, match.index, tag));
  }
  return result;
}

/**
 * Candidate regions holding the story, best first: the articleBody element,
 * the <article> that contains the headline (without nested cards), <main>,
 * and finally everything after the first <h1>.
 */
export function articleRegions(html: string): string[] {
  const regions: string[] = [];
  const body = html.search(/\bitemprop=["']articleBody["']/i);
  if (body >= 0) {
    const open = html.lastIndexOf("<", body);
    const tag = html.slice(open + 1).match(/^([a-z][a-z0-9]*)/i)?.[1];
    if (tag) regions.push(withoutNested(html.slice(open, elementEnd(html, open, tag)), "article"));
  }
  const headline = html.search(/<h1\b/i);
  const articles = [...html.matchAll(/<article\b[^>]*>/gi)].map(match => ({ start: match.index!, end: elementEnd(html, match.index!, "article"), news: /NewsArticle|itemprop=["']articleBody/i.test(match[0]) }));
  const main = articles.find(item => headline >= 0 && item.start < headline && item.end > headline) ?? articles.find(item => item.news);
  if (main) {
    // Related-story cards (nested <article>s) usually follow the body: stop at the first one.
    const firstCard = articles.find(item => item.start > main.start && item.start < main.end);
    if (firstCard) regions.push(html.slice(main.start, firstCard.start));
    regions.push(withoutNested(html.slice(main.start, main.end), "article"));
  }
  const mainTag = html.search(/<main\b/i);
  if (mainTag >= 0) regions.push(withoutNested(html.slice(mainTag, elementEnd(html, mainTag, "main")), "article"));
  if (headline >= 0) {
    // Some sites close <article> after the header and render the body beside it:
    // read from the headline to the first related-story card that follows.
    const after = Math.max(headline, main?.end ?? headline);
    const nextCard = articles.find(item => item.start > after);
    if (nextCard) regions.push(html.slice(headline, nextCard.start));
    regions.push(html.slice(headline));
  }
  regions.push(html);
  return regions;
}

/** The article text of a news page: JSON-LD articleBody, else the paragraphs of its largest <article>, else of <main>. */
export function extractArticle(html: string): { title: string; publishedAt: string | null; text: string } {
  const objects = jsonLdObjects(html);
  const article = objects.find(object => isArticleType(object["@type"]) && typeof object.articleBody === "string" && (object.articleBody as string).length >= MIN_SOURCE_CHARS);
  const meta = (name: string) => html.match(new RegExp(`<meta\\b[^>]*(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i"))?.[1]
    ?? html.match(new RegExp(`<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, "i"))?.[1];
  const title = xmlPlainText(String(article?.headline ?? meta("og:title") ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""));
  const dated = objects.find(object => isArticleType(object["@type"]) && typeof object.datePublished === "string");
  const publishedRaw = (dated?.datePublished as string | undefined) ?? meta("article:published_time") ?? null;
  const publishedAt = publishedRaw && Number.isFinite(Date.parse(publishedRaw)) ? new Date(Date.parse(publishedRaw)).toISOString() : null;
  let paragraphs: string[];
  if (article) {
    paragraphs = String(article.articleBody).split(/\n+|<\/p>/i).map(part => xmlPlainText(part)).filter(part => part.length >= 40 && !BOILERPLATE.test(part));
  } else {
    paragraphs = [];
    for (const region of articleRegions(html)) {
      const found = paragraphsOf(region);
      if (found.join(" ").length >= MIN_SOURCE_CHARS) { paragraphs = found; break; }
      if (found.join(" ").length > paragraphs.join(" ").length) paragraphs = found;
    }
  }
  let text = "";
  for (const paragraph of paragraphs) {
    const room = MAX_SOURCE_CHARS - text.length - 2;
    if (paragraph.length > room) {
      // Keep whole sentences of an oversized paragraph, then stop.
      const cut = paragraph.slice(0, Math.max(0, room)).replace(/[^.!?”"]*$/, "").trim();
      if (cut.length >= 200) text += `${text ? "\n\n" : ""}${cut}`;
      break;
    }
    text += `${text ? "\n\n" : ""}${paragraph}`;
  }
  return { title, publishedAt, text };
}

export type FetchOutcome = { url: string; status: "ok" | "skipped" | "failed"; reason?: string };

/** Fetch one article page as text, or null with a reason. */
export async function fetchSourceText(headline: WireHeadline, id: string): Promise<{ source: SourceText | null; outcome: FetchOutcome }> {
  if (headline.feedText && headline.feedText.length >= MIN_SOURCE_CHARS) {
    return { source: { id, outlet: headline.outlet, url: headline.url, title: headline.title, publishedAt: headline.publishedAt, text: headline.feedText.slice(0, MAX_SOURCE_CHARS), origin: "feed" }, outcome: { url: headline.url, status: "ok", reason: "feed full text" } };
  }
  if (!isFetchableArticleUrl(headline.url)) return { source: null, outcome: { url: headline.url, status: "skipped", reason: "outlet not fetched" } };
  const url = new URL(headline.url);
  const rules = await hostRobots(url.origin);
  if (rules === null) return { source: null, outcome: { url: headline.url, status: "skipped", reason: "robots.txt unavailable" } };
  if (!robotsAllows(rules, `${url.pathname}${url.search}`)) return { source: null, outcome: { url: headline.url, status: "skipped", reason: "robots.txt disallows" } };
  try {
    const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": WIRE_DESK_USER_AGENT, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(12_000) });
    // A redirect may leave the allowlist (consent walls, other domains).
    if (!response.ok || !isFetchableArticleUrl(response.url || headline.url) || !(response.headers.get("content-type") || "").includes("html")) {
      await response.body?.cancel();
      return { source: null, outcome: { url: headline.url, status: "failed", reason: `HTTP ${response.status}` } };
    }
    const html = await readBoundedText(response, MAX_HTML_BYTES);
    if (paywalled(html)) return { source: null, outcome: { url: headline.url, status: "skipped", reason: "paywalled" } };
    const extracted = extractArticle(html);
    if (extracted.text.length < MIN_SOURCE_CHARS) return { source: null, outcome: { url: headline.url, status: "failed", reason: "no article text" } };
    return {
      source: { id, outlet: headline.outlet, url: headline.url, title: extracted.title || headline.title, publishedAt: extracted.publishedAt ?? headline.publishedAt, text: extracted.text, origin: "page" },
      outcome: { url: headline.url, status: "ok" },
    };
  } catch (error) {
    return { source: null, outcome: { url: headline.url, status: "failed", reason: error instanceof Error ? error.name : "fetch failed" } };
  }
}

/**
 * Up to `limit` source texts for a story, one per outlet, fullest first among
 * the freshest candidates. Candidates are tried in parallel, three at a time.
 */
export async function gatherSources(members: readonly WireHeadline[], limit = 3): Promise<{ sources: SourceText[]; outcomes: FetchOutcome[] }> {
  const candidates = members
    .filter(member => member.feedText || isFetchableArticleUrl(member.url))
    .toSorted((a, b) => Number(Boolean(b.feedText)) - Number(Boolean(a.feedText)) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const perOutlet = new Map<string, WireHeadline[]>();
  for (const member of candidates) perOutlet.set(member.outlet, [...(perOutlet.get(member.outlet) ?? []), member]);
  const queue = [...perOutlet.values()].map(list => list.slice(0, 2)).flat();
  const sources: SourceText[] = [];
  const outcomes: FetchOutcome[] = [];
  const outlets = new Set<string>();
  for (let start = 0; start < queue.length && sources.length < limit; start += 3) {
    const batch = queue.slice(start, start + 3).filter(member => !outlets.has(member.outlet));
    const results = await Promise.all(batch.map((member, index) => fetchSourceText(member, `src${start + index + 1}`)));
    for (const result of results) {
      outcomes.push(result.outcome);
      if (result.source && !outlets.has(result.source.outlet) && sources.length < limit) { sources.push(result.source); outlets.add(result.source.outlet); }
    }
  }
  return { sources: sources.map((source, index) => ({ ...source, id: `S${index + 1}` })), outcomes };
}

export { urlHost };
