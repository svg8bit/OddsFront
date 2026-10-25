import assert from "node:assert/strict";
import { test } from "node:test";
import { gdeltSpike, gdeltTerms, parseRedditFeed, parseTraffic, parseTrendsFeed, scoreStories, spikeRatio, tokensMatch, viralScore, type TrendSignals } from "./signals.ts";
import { matchSiteArticle } from "../hot-desk/site-article.ts";
import { hotDeskCaption } from "../hot-desk/post.ts";
import { readableSiblings, type WireHeadline } from "../wire-desk/leads.ts";
import { headlineTokens } from "../hot-desk/headlines.ts";

const NOW = Date.parse("2026-10-25T15:00:00Z");

function story(title: string, extra: Partial<{ coverage: number; topStory: boolean; wire: boolean; members: { publishedAt: string }[] }> = {}) {
  return { title, titles: [title], fingerprint: headlineTokens(title), coverage: extra.coverage ?? 2, topStory: extra.topStory ?? false, wire: extra.wire, members: extra.members ?? [] };
}

const REDDIT = `<feed><entry><title>/r/WorldNews Live Thread: Russian Invasion of Ukraine Day 1705, Part 1 (Thread #1852)</title></entry>
<entry><title>Saudi Arabia intercepts Houthi missiles as Riyadh airport reopens</title></entry>
<entry><title>Thousands rally in Tel Aviv &amp; Jerusalem against Netanyahu</title></entry></feed>`;

const TRENDS = `<rss><channel><item><title>iran</title><ht:approx_traffic>50K+</ht:approx_traffic>
<ht:news_item><ht:news_item_title>Iran says new US strikes will not change its position</ht:news_item_title></ht:news_item></item>
<item><title>jalen ramsey</title><ht:approx_traffic>500+</ht:approx_traffic></item></channel></rss>`;

test("feeds: Reddit hot entries, trend traffic and trend headlines", () => {
  const reddit = parseRedditFeed(REDDIT);
  assert.equal(reddit.length, 3);
  assert.equal(reddit[0]!.title, "Russian Invasion of Ukraine Day 1705, Part 1");
  assert.equal(reddit[2]!.title, "Thousands rally in Tel Aviv & Jerusalem against Netanyahu");
  assert.deepEqual([parseTraffic("2000+"), parseTraffic("50K+"), parseTraffic("1.5M+"), parseTraffic("n/a")], [2000, 50000, 1500000, 0]);
  const trends = parseTrendsFeed(TRENDS);
  assert.deepEqual(trends.map(trend => [trend.query, trend.traffic]), [["iran", 50000], ["jalen ramsey", 500]]);
  assert.equal(trends[0]!.newsTitles.length, 1);
});

test("matching: same story needs three shared stems or two with a key name", () => {
  assert.equal(tokensMatch(headlineTokens("Saudi Arabia reopens Riyadh airport after Houthi attacks"), headlineTokens("Saudi Arabia intercepts Houthi missiles as Riyadh airport reopens")), true);
  // Two generic stems are not one story.
  assert.equal(tokensMatch(headlineTokens("A new way to understand the election and voters"), headlineTokens("Brazil election: voters choose between Lula and Bolsonaro")), false);
  assert.equal(tokensMatch(headlineTokens("Iran says strikes won't change position"), headlineTokens("Iran warns of new strikes")), true);
});

test("GDELT terms prefer key names, then proper nouns, then long stems", () => {
  assert.deepEqual(gdeltTerms("Saudi Arabia Reopens Riyadh Airport After Weeks of Houthi Attacks"), ["saudi", "riyadh"]);
  assert.deepEqual(gdeltTerms("Musk says SpaceX restricted Ukraine's Starlink connection"), ["musk", "ukraine"]);
  assert.deepEqual(gdeltTerms("Serbia election: Can student-led opposition end Aleksandar Vucic's grip"), ["aleksandar", "vucic"]);
  assert.equal(gdeltTerms("Votes counted").length, 2);
});

test("spike: last two hours against the median of the day", () => {
  assert.equal(spikeRatio([1, 2, 3]), null);
  const flat = Array(96).fill(1);
  assert.equal(spikeRatio(flat), 1);
  assert.equal(spikeRatio([...Array(88).fill(1), ...Array(8).fill(4)]), 4);
  assert.equal(spikeRatio([...Array(88).fill(0), ...Array(8).fill(2)]), 10);
});

test("score: outlets, freshness, Reddit, trends and GDELT add up and explain themselves", () => {
  const signals: TrendSignals = { reddit: parseRedditFeed(REDDIT), trends: parseTrendsFeed(TRENDS) };
  const fresh = Array.from({ length: 4 }, (_, index) => ({ publishedAt: new Date(NOW - index * 10 * 60_000).toISOString() }));
  const houthis = viralScore(story("Saudi Arabia reopens Riyadh airport after Houthi attacks", { coverage: 6, topStory: true, members: fresh }), signals, 3, NOW);
  assert.ok(houthis.score >= 60, String(houthis.score));
  assert.ok(houthis.signals.some(note => note.startsWith("Reddit hot #2")));
  assert.ok(houthis.signals.some(note => note.includes("×3.0")));
  const iran = viralScore(story("Iran says potential new US strikes won't change its position"), signals, null, NOW);
  assert.ok(iran.signals.some(note => note.includes('"iran" (50,000+)')));
  const quiet = viralScore(story("Local council approves budget"), signals, null, NOW);
  assert.equal(quiet.score, 8);
  assert.deepEqual(quiet.signals, []);
});

test("GDELT: refusals back off, spacing holds, scores use the spike", async () => {
  let calls = 0;
  const refusing = (async () => { calls += 1; return new Response("Please limit requests to one every 5 seconds", { status: 200 }); }) as typeof fetch;
  let clock = NOW;
  assert.equal(await gdeltSpike(["iran", "israel"], { request: refusing, now: () => clock }), null);
  clock += 60_000;
  assert.equal(await gdeltSpike(["iran", "israel"], { request: refusing, now: () => clock }), null);
  assert.equal(calls, 1, "a refusal pauses GDELT for half an hour");
  clock += 31 * 60_000;
  const timeline = { timeline: [{ data: [...Array(88).fill(1), ...Array(8).fill(3)].map(value => ({ value })) }] };
  const answering = (async () => new Response(JSON.stringify(timeline))) as typeof fetch;
  assert.equal(await gdeltSpike(["iran", "israel"], { request: answering, now: () => clock }), 3);
  const signals: TrendSignals = { reddit: [], trends: [] };
  clock += 10 * 60_000;
  const [scoredStory] = await scoreStories([story("Israel strikes Iran air defences overnight", { coverage: 4 })], signals, { gdeltLimit: 1, now: NOW, request: answering, clock: () => clock });
  assert.ok(scoredStory!.signals.some(note => note.includes("×3.0")));
});

test("site article: the newest recent article about the story, with a Russian link only when translated", () => {
  const articles = [
    { slug: "saudi-arabia-says-it-downed-houthi-missiles", title: "Saudi Arabia says it downed Houthi missiles and drones as Riyadh airport reopens", publishedAt: new Date(NOW - 3_600_000).toISOString(), translations: { ru: { title: "Саудовская Аравия сбила ракеты хуситов" } } },
    { slug: "old-houthi-story", title: "Saudi Arabia says Houthi missiles hit Riyadh airport", publishedAt: new Date(NOW - 30 * 3_600_000).toISOString() },
    { slug: "kremlin-talks", title: "Kremlin says it will resume talks with Ukraine", publishedAt: new Date(NOW - 600_000).toISOString() },
  ];
  assert.deepEqual(matchSiteArticle(story("Saudi Arabia Reopens Riyadh Airport After Weeks of Houthi Attacks"), articles, NOW), {
    slug: "saudi-arabia-says-it-downed-houthi-missiles",
    en: "https://oddsfront.com/en/news/saudi-arabia-says-it-downed-houthi-missiles",
    ru: "https://oddsfront.com/ru/news/saudi-arabia-says-it-downed-houthi-missiles",
  });
  assert.equal(matchSiteArticle(story("Taiwan holds military drills near Kinmen"), articles, NOW), null);
  assert.equal(matchSiteArticle(story("Kremlin resumes talks with Ukraine after summit"), [{ ...articles[2]!, slug: "Bad Slug" }], NOW), null);
});

test("caption: the headline links to the site article when there is one", () => {
  const copy = { category: "war" as const, titleEn: "Saudi Arabia downs Houthi missiles", titleRu: "Эр-Рияд сбил ракеты хуситов", cardTitleEn: "x", cardTitleRu: "x", contextEn: "Context.", contextRu: "Контекст.", marketQuestionRu: "Удар хуситов до 31 октября?" };
  const market = { question: "Houthi strike by October 31?", chance: 0.41, dayChange: 0.03 };
  const linked = hotDeskCaption(copy, market, "ru", "https://oddsfront.com/ru/news/saudi");
  assert.ok(linked.startsWith('⚡️ <b><a href="https://oddsfront.com/ru/news/saudi">Эр-Рияд сбил ракеты хуситов</a></b>'));
  assert.ok(!linked.includes("Сделать ставку"));
  assert.ok(hotDeskCaption(copy, market, "en").startsWith("⚡️ <b>Saudi Arabia downs Houthi missiles</b>"));
});

test("wire desk: readable sibling reports for a story told through aggregator links", () => {
  const head = (title: string, url: string, outlet: string): WireHeadline => ({ title, url, outlet, description: "", publishedAt: new Date(NOW - 600_000).toISOString(), topStory: false, wire: false });
  const members = [head("Iran says potential new US strikes won't change Tehran's position", "https://news.google.com/rss/articles/abc", "CBS News")];
  const headlines = [
    ...members,
    head("Iran says new U.S. strikes won't change Tehran position, minister says", "https://www.aljazeera.com/news/2026/10/25/iran-strikes", "Al Jazeera"),
    head("Iran says new US strikes won't change its position", "https://www.nytimes.com/2026/10/25/world/iran.html", "The New York Times"),
    head("Taiwan holds drills", "https://www.bbc.com/news/articles/taiwan", "BBC"),
  ];
  const siblings = readableSiblings(headlineTokens(members[0]!.title), members, headlines);
  assert.deepEqual(siblings.map(sibling => sibling.outlet), ["Al Jazeera"]);
});
