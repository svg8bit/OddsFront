import { expect, test } from "@playwright/test";
import seed from "../lib/news/catalog.seed.json";
import { collectNewsFeedDiscovery, NEWS_DISCOVERY_FEEDS, parseNewsDiscoveryFeed, selectNewsDiscoveryLeads, type NewsFeedDiscovery } from "../lib/news/feed-discovery";
import { researchPrompt } from "../lib/news/research";
import type { NewsArticle } from "../lib/news/types";

const now = Date.parse("2026-09-08T20:00:00Z");
const date = new Date(now - 60_000).toUTCString();
const bbc = NEWS_DISCOVERY_FEEDS[0];
const item = (title: string, url: string, published = date, extra = "") => `<item><title><![CDATA[${title}]]></title><link>${url}</link><pubDate>${published}</pubDate>${extra}</item>`;

test("RSS leads preserve publisher dates and reject foreign, future, stale and credential-bearing links", () => {
  const xml = `<rss><channel>${[
    item("Development fixture: sanctions &amp; border policy", "http://www.bbc.com/news/articles/fixture?utm_source=rss", date, '<media:thumbnail url="https://ichef.bbci.co.uk/development.jpg"/>'),
    item("Development fixture: foreign link", "https://unapproved.example/article"),
    item("Development fixture: impersonating publisher", "https://bbc.com@unapproved.example/article"),
    item("Development fixture: another approved publisher", "https://www.theguardian.com/world/article"),
    item("Development fixture: future timestamp", "https://www.bbc.com/news/future", new Date(now + 120_000).toUTCString()),
    item("Development fixture: old timestamp", "https://www.bbc.com/news/old", "Sun, 01 Jan 2023 10:00:00 GMT"),
    item("Development fixture: missing timestamp", "https://www.bbc.com/news/undated", ""),
    item("Development fixture: <scr<script>ipt>malicious markup", "https://www.bbc.com/news/markup"),
    item("Development fixture: &lt;script&gt;encoded markup", "https://www.bbc.com/news/encoded-markup"),
  ].join("")}</channel></rss>`;
  const leads = parseNewsDiscoveryFeed(xml, bbc, now);
  expect(leads).toHaveLength(1);
  expect(leads[0]).toMatchObject({ title: "Development fixture: sanctions & border policy", url: "https://bbc.com/news/articles/fixture", publishedAt: new Date(now - 60_000).toISOString(), photoCandidate: true });
});

test("publisher title cards do not become photo candidates and XML does not resolve external entities", () => {
  const meduza = NEWS_DISCOVERY_FEEDS.find(feed => feed.publisher === "Meduza")!;
  const xml = '<!DOCTYPE rss [<!ENTITY secret SYSTEM "file:///development-secret">]><rss>' + item("Development fixture: &secret; headline", "https://meduza.io/news/development-fixture", date, '<enclosure url="https://meduza.io/imgly/development.png"/>') + '</rss>';
  const [lead] = parseNewsDiscoveryFeed(xml, meduza, now);
  expect(lead.title).toContain("&secret;");
  expect(lead.photoCandidate).toBe(false);
});

test("discovery filters the complete published and private history while keeping publisher variety", () => {
  const original = { ...seed.articles[0], title: "Development fixture: nuclear inspection access restored", sources: [{ id: "m", kind: "media", publisher: "BBC", title: "Development fixture: nuclear inspection access restored", url: "https://www.bbc.com/news/already", publishedAt: new Date(now - 60_000).toISOString() }] } as NewsArticle;
  const make = (publisher: string, title: string, url: string) => ({ publisher, title, url, publishedAt: new Date(now - 60_000).toISOString(), photoCandidate: true });
  const discovery: NewsFeedDiscovery = { collectedAt: new Date(now).toISOString(), feeds: [], leads: [
    make("BBC", "Completely different rewritten source headline", "https://www.bbc.com/news/already?utm_source=rss"),
    make("The Guardian", original.title, "https://www.theguardian.com/world/new-path"),
    make("BBC", "Development fixture: Pacific islands agree maritime patrol funding", "https://www.bbc.com/news/new-a"),
    make("BBC", "Development fixture: European states extend coastal protection programme", "https://www.bbc.com/news/new-b"),
    make("The Guardian", "Development fixture: Chile approves emergency water supply plan", "https://www.theguardian.com/world/new-c"),
    make("Euronews", "Development fixture: Japan restarts regional electricity interconnector", "https://www.euronews.com/new-d"),
  ] };
  const selected = selectNewsDiscoveryLeads(discovery, [original], now);
  expect(selected).toHaveLength(4);
  expect(new Set(selected.slice(0, 3).map(lead => lead.publisher)).size).toBe(3);
  expect(selectNewsDiscoveryLeads(discovery, [{ ...original, withdrawal: { at: new Date(now).toISOString(), duplicateOf: "development-original" } }], now)).toEqual(selected);
});

test("feed collection bounds failures and exposes discovery data without replacing source verification", async () => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); urls.push(url);
    expect(init?.redirect).toBe("error");
    if (url.includes("guardian")) return new Response("blocked", { status: 403 });
    if (url.includes("axios")) return new Response("huge", { headers: { "content-type": "text/xml", "content-length": "2000000" } });
    const xml = url === bbc.url ? item("Development fixture: new verified-source lead", "https://www.bbc.com/news/new") : "<rss/>";
    return new Response(xml, { headers: { "content-type": "text/xml" } });
  };
  const discovery = await collectNewsFeedDiscovery(fetcher, now);
  expect(urls).toHaveLength(NEWS_DISCOVERY_FEEDS.length);
  expect(discovery.leads).toHaveLength(1);
  expect(discovery.feeds.filter(feed => feed.status === "unavailable")).toHaveLength(2);
  const prompt = researchPrompt([], 5, new Date(now), [], discovery);
  expect(prompt).toContain("never sufficient publication evidence");
  expect(prompt).toContain("https://bbc.com/news/new");
  expect(prompt).toContain("at least one primary institutional source");
  expect(prompt).toContain("source-use budget and novelty");
});
