// Unit tests for the website wire desk: `npm run test:wire-desk` (node:test, no network, no model).
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanArticleUrl, isFetchableArticleUrl, normalizeOutlet } from "./feeds.ts";
import { feedFullTexts, openStories, parseWireFeed, storiesNeedingEvaluation, topicalScore, wireStories, type WireHeadline } from "./leads.ts";
import { acceptedPicks, selectionPrompt } from "./selection.ts";
import { articleRegions, extractArticle, paywalled, robotsAllows, robotsRules } from "./source-text.ts";
import { allowedNumbers, copyProblems, numbersIn, sourceOverlap, unsupportedNumbers, type ArticleCopy } from "./checks.ts";
import { ARTICLE_FORMAT, articlePrompt, cleanDraft, draftToArticle, parseArticleAnswer, reviewDraft, type ArticleDraft } from "./article.ts";
import { articleAllowance, backOff, countCall, countPublished, currentBudget, EMPTY_WIRE_STATE, runBlock, wireDeskPolicy } from "./state.ts";
import { loadCatalog, publishArticle, retireSeedArticles, revalidationPaths } from "./publish.ts";
import { coverFocus, focusOverlaySvg } from "./cover.ts";
import { marketBrief, percentText, type StoryMarket } from "./markets.ts";
import { isRevalidationPath } from "../revalidation.ts";
import { createClaudeWriterInvocation } from "../writer.ts";
import type { NewsArticle, NewsCatalog } from "../types.ts";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 36e5).toUTCString();
const headline = (outlet: string, title: string, url = `https://www.bbc.com/news/${encodeURIComponent(title).slice(0, 30)}`, extra: Partial<WireHeadline> = {}): WireHeadline =>
  ({ outlet, title, description: "", url, publishedAt: new Date(NOW - 36e5).toISOString(), topStory: false, wire: false, ...extra });

test("feeds: tracking parameters are dropped and only allowlisted, non-live pages are fetched", () => {
  assert.equal(cleanArticleUrl("https://www.aljazeera.com/news/2026/10/25/story?traffic_source=rss&utm_source=x#top"), "https://www.aljazeera.com/news/2026/10/25/story");
  assert.equal(cleanArticleUrl("https://example.com/a?id=7&utm_medium=rss"), "https://example.com/a?id=7");
  assert.equal(isFetchableArticleUrl("https://www.bbc.com/news/articles/c123"), true);
  assert.equal(isFetchableArticleUrl("https://www.bbc.com/news/live/c123"), false);
  assert.equal(isFetchableArticleUrl("https://www.nytimes.com/2026/10/25/world/x.html"), false);
  assert.equal(isFetchableArticleUrl("https://apnews.com/article/x"), false);
  assert.equal(isFetchableArticleUrl("https://unknown-blog.example/x"), false);
  assert.equal(isFetchableArticleUrl("http://www.bbc.com/news/articles/c123"), false);
  assert.equal(normalizeOutlet("The Associated Press"), "AP");
  assert.equal(normalizeOutlet("AP News"), "AP");
});

test("feeds: wire search results are leads, full-text feeds keep their text, outlets are normalized", () => {
  const body = "<p>" + "Officials in Washington confirmed the decision on Sunday. ".repeat(30) + "</p>";
  const xml = `<rss><channel>
    <item><title>US imposes new sanctions on Iranian oil exports - AP News</title><link>https://news.google.com/rss/articles/abc</link><pubDate>${hoursAgo(1)}</pubDate><source url="https://apnews.com">AP News</source></item>
  </channel></rss>`;
  const [wire] = parseWireFeed(xml, { publisher: "Google News", url: "https://news.google.com/rss/search?q=x", aggregator: true, wire: true }, NOW, 10 * 36e5);
  assert.deepEqual([wire!.outlet, wire!.wire, wire!.topStory, wire!.title], ["AP", true, false, "US imposes new sanctions on Iranian oil exports"]);
  const full = `<rss><channel><item><title>Senate passes defense bill after long standoff</title><link>https://www.foxnews.com/politics/senate-bill?intcmp=rss</link><pubDate>${hoursAgo(2)}</pubDate><content:encoded><![CDATA[${body}]]></content:encoded></item></channel></rss>`;
  assert.ok((feedFullTexts(full).get("https://www.foxnews.com/politics/senate-bill?intcmp=rss") ?? "").length > 1200);
  const [fox] = parseWireFeed(full, { publisher: "Fox News", url: "https://moxie.foxnews.com/x", fullText: true }, NOW, 10 * 36e5);
  assert.equal(fox!.url, "https://www.foxnews.com/politics/senate-bill");
  assert.ok((fox!.feedText ?? "").startsWith("Officials in Washington"));
});

test("leads: stories carry members, topic score, and leave the pool once written", () => {
  const stories = wireStories([
    headline("BBC", "US Navy seizes Iranian tanker near Strait of Hormuz", "https://www.bbc.com/news/a"),
    headline("CBS News", "Iranian tanker seized by US Navy near Strait of Hormuz", "https://www.cbsnews.com/news/b"),
    headline("ABC News", "Celebrity chef opens new restaurant in Paris", "https://abcnews.go.com/c"),
  ]);
  const hormuz = stories.find(story => story.coverage === 2)!;
  assert.equal(hormuz.members.length, 2);
  assert.ok(hormuz.topical > 0);
  assert.equal(topicalScore({ titles: ["Celebrity chef opens new restaurant in Paris"], description: "" }), 0);
  assert.equal(storiesNeedingEvaluation(stories, [], NOW).length, 1);
  assert.equal(storiesNeedingEvaluation(stories, [{ at: new Date(NOW - 60_000).toISOString(), fingerprint: hormuz.fingerprint }], NOW).length, 0);
  assert.equal(openStories(stories, [{ url: "https://www.bbc.com/news/a", at: new Date(NOW).toISOString() }], [], NOW).includes(hormuz), false);
  assert.equal(openStories(stories, [], [{ at: new Date(NOW - 36e5).toISOString(), title: "x", fingerprint: hormuz.fingerprint }], NOW).includes(hormuz), false);
  assert.equal(openStories(stories, [], [{ at: new Date(NOW - 8 * 36e5).toISOString(), title: "x", fingerprint: hormuz.fingerprint }], NOW).includes(hormuz), true);
});

test("selection: merged ids, priority bar, coverage rule and no id reused", () => {
  const stories = wireStories([
    headline("BBC", "Pentagon readies options for strikes on Iran", "https://www.bbc.com/news/1"),
    headline("CBS News", "Trump briefed on Iran attack plans by generals", "https://www.cbsnews.com/news/2"),
    headline("Al Jazeera", "Iran warns Washington against new strikes", "https://www.aljazeera.com/news/3"),
    headline("AP", "Ukraine and Russia swap prisoners in Turkey-brokered deal", "https://news.google.com/rss/articles/4", { wire: true }),
    headline("BBC", "Regional football derby ends in draw", "https://www.bbc.com/sport/5"),
  ]);
  const id = (fragment: string) => stories.find(story => story.title.includes(fragment))!.id;
  const picks = acceptedPicks({ stories: [
    { storyIds: [id("Pentagon"), id("Trump briefed"), id("Iran warns")], priority: 8, category: "war", development: "The Pentagon has prepared strike options against Iran.", countryCodes: ["US", "IR", "zz"], marketQueries: ["US strike Iran", "x"] },
    { storyIds: [id("Trump briefed")], priority: 7, category: "war", development: "dup", countryCodes: [], marketQueries: [] },
    { storyIds: [id("Ukraine")], priority: 6, category: "geopolitics", development: "Prisoner swap.", countryCodes: ["UA", "RU"], marketQueries: ["Ukraine ceasefire"] },
    { storyIds: [id("football")], priority: 9, category: "world-politics", development: "single outlet", countryCodes: [], marketQueries: [] },
    { storyIds: ["s999"], priority: 9, category: "war", development: "unknown", countryCodes: [], marketQueries: [] },
    { storyIds: [id("Ukraine")], priority: 4, category: "war", development: "low", countryCodes: [], marketQueries: [] },
  ] }, stories);
  assert.equal(picks.length, 2);
  assert.deepEqual([picks[0]!.coverage, picks[0]!.countryCodes, picks[0]!.marketQueries], [3, ["US", "IR"], ["US strike Iran"]]);
  assert.equal(picks[1]!.wire, true);
  assert.match(selectionPrompt(stories, [{ title: "Old story", publishedAt: new Date(NOW - 36e5).toISOString() }], 3, NOW), /ALREADY PUBLISHED.*Old story/);
});

test("source text: robots rules, JSON-LD bodies, nested cards and paywalls", () => {
  const rules = robotsRules("User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /*?traffic_source=\nDisallow: /search/\nAllow: /search/public\n");
  assert.equal(robotsAllows(rules, "/news/2026/10/25/story"), true);
  assert.equal(robotsAllows(rules, "/news/2026/10/25/story?traffic_source=rss"), false);
  assert.equal(robotsAllows(rules, "/search/public/x"), true);
  assert.equal(robotsAllows(robotsRules("User-agent: OddsFrontNewsDesk\nDisallow: /\nUser-agent: *\nAllow: /\n"), "/x"), false);
  const sentence = "The foreign ministry said the talks would resume in Muscat next week after a pause of several days. ";
  const ld = `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", headline: "Talks resume", datePublished: "2026-10-25T09:00:00Z", articleBody: sentence.repeat(14) })}</script></head><body></body></html>`;
  const fromLd = extractArticle(ld);
  assert.equal(fromLd.title, "Talks resume");
  assert.equal(fromLd.publishedAt, "2026-10-25T09:00:00.000Z");
  assert.ok(fromLd.text.length > 900 && fromLd.text.length <= 8000);
  const paragraphs = Array.from({ length: 12 }, (_, index) => `<p>Paragraph ${index}: ${sentence}</p>`).join("");
  const nested = `<html><body><article itemType="https://schema.org/NewsArticle"><h1>Headline</h1>${paragraphs}<article class="card"><p>Unrelated related-story card text that should never be read as part of the article at all.</p></article></article><p>Advertisement</p></body></html>`;
  const extracted = extractArticle(nested).text;
  assert.ok(extracted.includes("Paragraph 11"));
  assert.ok(!extracted.includes("Unrelated related-story"));
  assert.ok(articleRegions(nested).length >= 2);
  assert.equal(paywalled(`<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>`), true);
  assert.equal(paywalled(ld), false);
});

const sourceText = "Saudi Arabia said on Sunday that its air defences intercepted a ballistic missile fired toward Riyadh and 10 more missiles aimed at the south of the kingdom, according to the coalition spokesman. The airport reopened Terminal 2 for international flights after closing on October 10.";

test("checks: copied runs, quoted text, numbers in both languages", () => {
  const copied = sourceOverlap(`Officials said ${sourceText}`, [sourceText]);
  assert.ok(copied.ratio > 0.5 && copied.longestRun >= 20 && copied.phrases.length >= 1);
  const original = sourceOverlap("Riyadh's defences stopped one ballistic missile on Sunday, while the coalition reported ten further interceptions over southern provinces.", [sourceText]);
  assert.equal(original.longestRun, 0);
  const quoted = sourceOverlap(`The spokesman said: “${sourceText.slice(0, 120)}”`, [sourceText]);
  assert.equal(quoted.ratio, 0);
  assert.deepEqual(numbersIn("1,300 arrests and 4.5% growth in 2026"), ["1300", "4.5", "2026"]);
  assert.deepEqual(numbersIn("1 300 задержанных и рост на 4,5%", "ru"), ["1300", "4.5"]);
  const allowed = allowedNumbers([sourceText]);
  assert.deepEqual(unsupportedNumbers("It fired 10 missiles on October 10, 2026, the third attack, and 300 drones.", allowed), ["300"]);
  assert.deepEqual(unsupportedNumbers("Выпущено 10 ракет 10 октября.", allowed, "ru"), []);
});

const longParagraph = (topic: string) => `${topic} officials described the decision as a turning point for regional security, and diplomats in several capitals said they were studying its consequences for the coming weeks and months ahead.`;
const enCopy = (title = "Saudi air defences intercept Houthi missiles over Riyadh after airport reopens"): ArticleCopy => ({
  title,
  description: "The Saudi-led coalition said it shot down a ballistic missile aimed at the capital and ten more launched toward the kingdom's south on Sunday.",
  body: [
    { type: "paragraph", text: `${longParagraph("Saudi")} ${longParagraph("Coalition")}` },
    { type: "paragraph", text: `${longParagraph("Yemeni")} ${longParagraph("Houthi")}` },
    { type: "heading", text: "What happens next" },
    { type: "paragraph", text: `${longParagraph("Airport")} ${longParagraph("Airline")}` },
    { type: "paragraph", text: `${longParagraph("Western")} ${longParagraph("Gulf")}` },
    { type: "paragraph", text: `${longParagraph("United Nations")} ${longParagraph("Aid")}` },
    { type: "paragraph", text: `${longParagraph("Market")} ${longParagraph("Energy")}` },
    { type: "paragraph", text: `${longParagraph("European")} ${longParagraph("Asian")}` },
  ],
});
const ruParagraph = "Официальные лица назвали решение поворотным моментом для региональной безопасности, а дипломаты в нескольких столицах изучают его последствия на ближайшие недели.";
const ruCopy = (): ArticleCopy => ({
  title: "Саудовская ПВО перехватила ракеты хуситов над Эр-Риядом после открытия аэропорта",
  description: "Возглавляемая саудитами коалиция сообщила, что в воскресенье сбила баллистическую ракету над столицей и ещё десять ракет над югом королевства.",
  body: enCopy().body.map(block => (block.type === "heading" ? { type: "heading" as const, text: "Что дальше" } : { type: "paragraph" as const, text: `${ruParagraph} ${ruParagraph}` })),
});

test("checks: structure, casualty headlines in both languages, foreign elections, points wording", () => {
  assert.deepEqual(copyProblems(enCopy(), ruCopy()), []);
  assert.ok(copyProblems(enCopy("Houthi strike on Riyadh leaves 12 people dead as airport reopens"), ruCopy()).some(problem => problem.startsWith("headline-policy:casualties")));
  assert.ok(copyProblems(enCopy(), { ...ruCopy(), title: "В Эр-Рияде погибли 12 человек после удара хуситов по аэропорту" }).some(problem => problem.includes("casualties")));
  assert.ok(copyProblems(enCopy("Netanyahu challenger gains ground days before Israeli election vote"), ruCopy()).some(problem => problem.startsWith("headline-policy:foreign-election")));
  assert.ok(!copyProblems(enCopy("Trump campaign shifts midterm election strategy in swing states"), ruCopy()).some(problem => problem.includes("foreign-election")));
  const pp = enCopy(); pp.body[1] = { type: "paragraph", text: `${pp.body[1]!.text} The odds rose 5 pp in a day.` };
  assert.ok(copyProblems(pp, ruCopy()).some(problem => problem.includes("never points")));
  assert.ok(copyProblems(enCopy(), { ...ruCopy(), body: enCopy().body }).some(problem => problem.includes("written in Russian")));
  assert.ok(copyProblems({ ...enCopy(), body: enCopy().body.slice(0, 3) }, ruCopy()).some(problem => problem.includes("too thin")));
});

const SOURCES = [{ id: "S1", outlet: "Al Jazeera", url: "https://www.aljazeera.com/news/2026/10/25/a", title: "Saudi Arabia intercepts missiles", publishedAt: "2026-10-25T10:00:00.000Z", text: sourceText, origin: "page" as const }];
const draft = (overrides: Partial<ArticleDraft> = {}): ArticleDraft => cleanDraft({ publishable: true, rejectionReason: "", en: enCopy(), ru: ruCopy(), countries: ["SA", "YE"], topics: ["Security", "Houthis"], factChecks: [{ claim: "a", sourceIds: ["S1"] }, { claim: "b", sourceIds: ["S1"] }, { claim: "c", sourceIds: ["S1"] }], marketId: null, ...overrides });
const MARKET: StoryMarket = { id: "5999258", question: "Houthi x Saudi Arabia effective ceasefire by December 31?", slug: "x", conditionId: null, eventId: "77", eventTitle: "Houthi x Saudi Arabia ceasefire", eventSlug: "x", yesTokenId: "1".repeat(20), chance: 0.415, yesPrice: 0.42, noPrice: 0.59, dayChange: 0.05, weekChange: null, volume: 120_000, liquidity: 9_000, endDate: "2026-12-31T00:00:00.000Z", image: null, queries: ["Houthi Saudi"] };

test("article: review separates fixable problems from policy rejections and duplicates", () => {
  assert.deepEqual(reviewDraft(draft(), SOURCES, [], []).problems, []);
  assert.equal(reviewDraft(draft({ publishable: false, rejectionReason: "off-topic" }), SOURCES, [], []).fixable, false);
  const badMarket = reviewDraft(draft({ marketId: "123" }), SOURCES, [MARKET], []);
  assert.ok(badMarket.fixable && badMarket.problems.some(problem => problem.includes("marketId")));
  const invented = draft(); invented.en.body[1] = { type: "paragraph", text: `${invented.en.body[1]!.text} Some 4,700 troops moved south.` };
  assert.ok(reviewDraft(invented, SOURCES, [], []).problems.some(problem => problem.includes("4700")));
  const withMarket = draft({ marketId: MARKET.id }); withMarket.en.body[5] = { type: "paragraph", text: `${withMarket.en.body[5]!.text} On Polymarket, traders put the chance of an effective ceasefire by December 31 at 42%, up from 37% a day earlier.` };
  assert.deepEqual(reviewDraft(withMarket, SOURCES, [MARKET], []).problems, []);
  // A casualty-framed headline is sent back for reframing, never published.
  const casualty = reviewDraft(draft({ en: enCopy("Houthi missiles leave 9 people dead in Riyadh as airport reopens") }), SOURCES, [], []);
  assert.ok(casualty.fixable && casualty.problems.some(problem => problem.startsWith("headline-policy:casualties")));
  const article = draftToArticle(draft(), SOURCES, "2026-10-25T12:00:00.000Z");
  const duplicate = reviewDraft(draft(), SOURCES, [], [article]);
  assert.equal(duplicate.fixable, false);
  assert.match(duplicate.problems[0]!, /already published/);
});

test("article: catalog record, prompt and schema order", () => {
  const article = draftToArticle(draft(), SOURCES, "2026-10-25T12:00:00.000Z");
  assert.equal(article.slug, "saudi-air-defences-intercept-houthi-missiles-over-riyadh-after-airport-reopens");
  assert.equal(article.translations.ru?.editorReviewed, true);
  assert.deepEqual(Object.keys(article.translations), ["ru"]);
  assert.equal(article.sources[0]!.publisher, "Al Jazeera");
  const prompt = articlePrompt({ stories: wireStories([headline("BBC", "Saudi Arabia intercepts Houthi missiles over Riyadh")]), priority: 7, category: "war", development: "Saudi Arabia intercepted missiles.", countryCodes: ["SA"], marketQueries: [], coverage: 2, outlets: ["BBC"], wire: false }, SOURCES, [MARKET], [], NOW, ["fix this"]);
  assert.match(prompt, /<source id="S1" outlet="Al Jazeera"/);
  assert.match(prompt, /ANSWER FORMAT/);
  assert.ok(prompt.includes(ARTICLE_FORMAT));
  assert.match(prompt, /"yesChance":"42%"/);
  assert.match(prompt, /PREVIOUS DRAFT WAS REJECTED[\s\S]*fix this/);
  assert.deepEqual([percentText(0.415), percentText(0.045, "ru"), marketBrief(MARKET).dayAgo], ["42%", "4,5%", "37%"]);
});

test("article: the tagged answer parses into a draft, quotes and all", () => {
  const answer = `Here you go.
<publishable>yes</publishable>
<rejection></rejection>
<facts>
S1, S2 | The coalition intercepted a missile aimed at Riyadh.
S1 | Terminal 2 reopened for international flights.
- no ids here
</facts>
<market>5999258</market>
<countries>SA, ye, Saudi</countries>
<topics>Security; Houthis; Yemen</topics>
<en_title>Saudi air defences intercept Houthi missiles over Riyadh</en_title>
<en_description>The coalition said it stopped a missile aimed at the capital.</en_description>
<en_body>
The coalition said its defences stopped a missile, calling it a "hostile act".

## What happens next
Airlines are watching the airport.

Final paragraph.
</en_body>
<ru_title>Саудовская ПВО перехватила ракеты хуситов</ru_title>
<ru_description>Коалиция сообщила о перехвате ракеты.</ru_description>
<ru_body>
Коалиция назвала это «враждебным актом».

## Что дальше

Авиакомпании следят за аэропортом.
</ru_body>`;
  const parsed = parseArticleAnswer(answer)!;
  assert.equal(parsed.publishable, true);
  assert.deepEqual(parsed.factChecks.map(fact => fact.sourceIds), [["S1", "S2"], ["S1"], []]);
  assert.deepEqual([parsed.marketId, parsed.countries, parsed.topics], ["5999258", ["SA", "YE"], ["Security", "Houthis", "Yemen"]]);
  assert.deepEqual(parsed.en.body.map(block => block.type), ["paragraph", "heading", "paragraph", "paragraph"]);
  assert.match(parsed.en.body[0]!.text, /"hostile act"/);
  assert.deepEqual(parsed.ru.body.map(block => block.text), ["Коалиция назвала это «враждебным актом».", "Что дальше", "Авиакомпании следят за аэропортом."]);
  assert.equal(parseArticleAnswer("no tags at all"), null);
  assert.equal(parseArticleAnswer("<publishable>no</publishable><rejection>off-topic</rejection>")!.publishable, false);
});

test("state: paced daily allowance, call caps, back-off and day reset", () => {
  const policy = wireDeskPolicy({});
  const morning = Date.parse("2026-10-25T03:00:00Z");
  assert.equal(articleAllowance(EMPTY_WIRE_STATE, policy, morning), 3);
  let state = EMPTY_WIRE_STATE;
  for (let index = 0; index < 6; index += 1) state = countPublished(state, morning);
  assert.equal(articleAllowance(state, policy, morning), 0); // 4 burst + 20 × 3/24 = 6.5 → 6
  assert.equal(runBlock(state, policy, morning), "daily-article-cap");
  assert.equal(articleAllowance(state, policy, Date.parse("2026-10-25T18:00:00Z")), 3);
  assert.equal(currentBudget(state, Date.parse("2026-10-26T00:10:00Z")).published, 0);
  let calls = EMPTY_WIRE_STATE;
  for (let index = 0; index < 48; index += 1) calls = countCall(calls, "selectionCalls", morning);
  assert.equal(runBlock(calls, policy, morning), "daily-selection-cap");
  const backedOff = backOff(EMPTY_WIRE_STATE, NOW);
  assert.equal(runBlock(backedOff, policy, NOW + 60_000), "usage-limit-backoff");
  assert.equal(backOff(backOff(backOff(backOff(EMPTY_WIRE_STATE, NOW), NOW), NOW), NOW).backoff.until, NOW + 24 * 36e5);
});

const catalogArticle = (slug: string, publishedAt: string, id = slug.slice(0, 20)): NewsArticle => ({ id, slug, title: slug.replace(/-/g, " "), description: "d", body: [{ type: "paragraph", text: "body" }], countries: ["UA"], topics: ["Diplomacy"], author: "OddsFront Newsdesk", publishedAt, updatedAt: publishedAt, sources: [], translations: {} });

test("publish: bootstrap from the public export, per-article export with cover, seed retirement, refresh paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wire-desk-test-"));
  const privateDirectory = path.join(root, "private");
  const publicDirectory = path.join(root, "public");
  await mkdir(path.join(publicDirectory, "articles"), { recursive: true });
  await mkdir(privateDirectory, { recursive: true });
  const seed = catalogArticle("witkoff-meets-zelensky", "2026-09-06T16:47:54.046Z", "e4d9193f722f244dbba5");
  await writeFile(path.join(publicDirectory, "articles", `${seed.slug}.json`), JSON.stringify(seed));
  await writeFile(path.join(publicDirectory, "catalog.json"), JSON.stringify({ version: 1, updatedAt: seed.updatedAt, articles: [{ ...seed, body: [], views7d: 4 }], marketTranslations: { ru: { "Will X?": "Будет ли X?" } } }));
  const { catalog, bootstrapped } = await loadCatalog(privateDirectory, publicDirectory);
  assert.equal(bootstrapped, true);
  assert.deepEqual([catalog.articles[0]!.body.length, "views7d" in catalog.articles[0]!, catalog.marketTranslations.ru?.["Will X?"]], [1, false, "Будет ли X?"]);
  const fresh = { ...draftToArticle(draft(), SOURCES, "2026-10-25T12:00:00.000Z"), cover: { kind: "own" as const, imageUrl: "cover.jpg", sourceUrl: "", verifiedAt: "2026-10-25T12:00:00.000Z" } };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const published = await publishArticle(privateDirectory, publicDirectory, catalog, fresh, jpeg);
  await assert.rejects(publishArticle(privateDirectory, publicDirectory, published, fresh, null), /already exists/);
  const index = JSON.parse(await readFile(path.join(publicDirectory, "catalog.json"), "utf8")) as NewsCatalog;
  assert.deepEqual(index.articles.map(article => article.slug), [fresh.slug, seed.slug]);
  assert.equal(index.articles[0]!.body.length, 0);
  assert.equal(index.marketTranslations.ru?.["Will X?"], "Будет ли X?");
  assert.equal(((await stat(path.join(publicDirectory, "covers", `${fresh.slug}.jpg`))).mode & 0o777), 0o644);
  assert.deepEqual(await readFile(path.join(publicDirectory, "covers", `${fresh.slug}.jpg`)), jpeg);
  const { catalog: retiredCatalog, retired } = await retireSeedArticles(privateDirectory, publicDirectory, published, new Set([seed.id]), NOW);
  assert.deepEqual([retired.map(article => article.slug), retiredCatalog.articles.map(article => article.slug)], [[seed.slug], [fresh.slug]]);
  await assert.rejects(stat(path.join(publicDirectory, "articles", `${seed.slug}.json`)));
  const reloaded = await loadCatalog(privateDirectory, publicDirectory);
  assert.deepEqual([reloaded.bootstrapped, reloaded.catalog.articles.length], [false, 1]);
  const paths = revalidationPaths(retiredCatalog, [fresh], retired);
  for (const expected of ["/news", "/ru/news", "/news/rss.xml", "/ru/news/rss.xml", "/news-sitemap.xml", "/news-sitemaps/en-1.xml", "/news-sitemaps/ru-1.xml", "/news/topic/strikes", "/ru/news/sa", "/en/news/witkoff-meets-zelensky"]) assert.ok(paths.includes(expected), expected);
  assert.ok(paths.every(isRevalidationPath));
});

test("publish: reserved feed file names are never article slugs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wire-desk-reserved-"));
  const reserved = { ...draftToArticle(draft(), SOURCES, "2026-10-25T12:00:00.000Z"), slug: "market-translations-ru" };
  await assert.rejects(publishArticle(path.join(root, "p"), path.join(root, "q"), { version: 1, updatedAt: "2026-10-25T00:00:00.000Z", articles: [], marketTranslations: {} }, reserved, null), /reserved/);
  assert.ok(reviewDraft(draft({ en: { ...enCopy(), title: "Market translations RU" } }), SOURCES, [], []).problems.some(problem => problem.includes("reserved")));
});

test("revalidation route allowlist", () => {
  for (const ok of ["/news", "/ru/news", "/ru/news/topic/strikes", "/news/archive/2", "/en/news/some-story-slug", "/news-sitemaps/ru-1.xml", "/sitemaps/articles-1.xml", "/ru/news/rss.xml"]) assert.equal(isRevalidationPath(ok), true, ok);
  for (const bad of ["/", "/api/news", "/news/../etc", "/xx/news", "/de/news", "/news-sitemaps/zh-1.xml", "/en/news/Bad_Slug", "https://oddsfront.com/news", "/sitemaps/../x.xml", 42]) assert.equal(isRevalidationPath(bad), false, String(bad));
});

test("cover: frames the story's own country first and marks the location", () => {
  const events = [
    { id: "polymarket-1", title: "Yemen", coordinates: [44.2, 15.3] as [number, number], countryCodes: ["YE", "SA"], locationId: "ye", marketConditionId: null, volume: 9e6, marketVolume: 9e6, geographyKind: "country" },
    { id: "polymarket-2", title: "Saudi", coordinates: [46.7, 24.7] as [number, number], countryCodes: ["SA"], locationId: "sa", marketConditionId: null, volume: 1e5, marketVolume: 1e5, geographyKind: "country" },
  ] as Parameters<typeof coverFocus>[0]["events"];
  assert.equal(coverFocus({ events, anchors: [] }, ["SA", "YE"], null)?.eventId, "polymarket-2");
  assert.equal(coverFocus({ events: [events[0]!], anchors: [{ iso2: "SA", coordinates: [45, 24] }] }, ["SA"], null)?.kind, "country");
  assert.equal(coverFocus({ events: [], anchors: [] }, ["SA"], null), null);
  assert.match(focusOverlaySvg(960, 540), /cx="960" cy="540" r="48"/);
});

test("writer: a lean task prompt and no thinking for desk calls", () => {
  const invocation = createClaudeWriterInvocation({ schema: { type: "object" }, model: "sonnet", purpose: "article", env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "test-only-not-a-key" }, systemPrompt: "Desk prompt", disableThinking: true });
  assert.equal(invocation.env.MAX_THINKING_TOKENS, "0");
  assert.equal(invocation.env.ANTHROPIC_API_KEY, undefined);
  assert.deepEqual(invocation.args.slice(invocation.args.indexOf("--system-prompt"), invocation.args.indexOf("--system-prompt") + 3), ["--system-prompt", "Desk prompt", "--disable-slash-commands"]);
  assert.deepEqual(invocation.args.slice(invocation.args.indexOf("--tools"), invocation.args.indexOf("--tools") + 2), ["--tools", ""]);
  assert.equal(invocation.args[invocation.args.indexOf("--max-turns") + 1], "6");
});

test("article markets: the cited market first, then markets about the same actors, never a country-only match", async () => {
  const { articleMarkets } = await import("./markets.ts");
  const market = (id: string, question: string, volume: number, queries = ["q"]) => ({ id, question, slug: id, conditionId: `0x${id}`, eventId: id, eventTitle: question, eventSlug: `event-${id}`, yesTokenId: `${id}0000000000`, chance: 0.3, yesPrice: 0.31, noPrice: 0.7, dayChange: null, weekChange: 0.02, volume, liquidity: 9000, endDate: "2026-12-31T00:00:00Z", image: null, queries });
  const found = [
    market("1", "Will Trump impose new tariffs on the EU by December 31?", 900_000),
    market("2", "NATO x Russia military clash by December 31, 2026?", 3_400_000),
    market("3", "Will Trump raise tariffs on European cars by November 30?", 200_000, ["q", "r"]),
  ];
  const story = { title: "Audi to build $4bn SUV plant in Georgia as Volkswagen grapples with Trump tariffs", development: "Trump announced an Audi factory in Georgia amid EU car tariffs.", topics: ["Tariffs", "Audi", "Volkswagen"] };
  const shown = articleMarkets(found, "1", story);
  assert.deepEqual(shown.map(item => item.id), ["1", "3"]);
  assert.equal(shown[0]!.eventSlug, "event-1");
  assert.equal(shown[0]!.yesTokenId, "10000000000");
  assert.deepEqual(articleMarkets([found[1]!], null, story), []);
  // Deadline variants of one market collapse into one card.
  const variants = [market("4", "Will Trump impose new tariffs on the EU by October 31?", 100_000), ...found];
  assert.deepEqual(articleMarkets(variants, "1", story).map(item => item.id), ["1", "3"]);
});

test("related map markets need shared words, a shared country only breaks ties", async () => {
  const { relatedMarkets } = await import("../related-markets.ts");
  const event = (id: string, title: string, countryCodes: string[], volume: number) => ({ id, title, countryCodes, volume, dataOrigin: "polymarket", marketUrl: `https://polymarket.com/event/${id}`, endDate: null }) as unknown as Parameters<typeof relatedMarkets>[1][number];
  const events = [event("nato", "NATO x Russia military clash by December 31, 2026?", ["RU", "US", "DE"], 3_400_000), event("iran", "US x Iran ceasefire continues through October 31?", ["US", "IR"], 900_000)];
  assert.deepEqual(relatedMarkets({ title: "Audi to build $4bn SUV plant in Georgia amid Trump tariffs", countries: ["US", "DE"], topics: ["Tariffs"] }, events), []);
  assert.deepEqual(relatedMarkets({ title: "Iran says the ceasefire with the US holds despite threats", countries: ["IR", "US"], topics: ["Iran"] }, events).map(item => item.id), ["iran"]);
});
