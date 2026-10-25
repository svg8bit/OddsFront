// Unit tests for the Telegram hot desk: `npm run test:hot-desk` (node:test, no server).
import assert from "node:assert/strict";
import { test } from "node:test";
import { clusterHeadlines, parseHeadlines, sameStory, similarTokens, type Headline } from "./headlines.ts";
import { normalizeMarket, type GammaMarket } from "./markets.ts";
import { betKeyboard, copyProblems, formatChange, formatPercent, hotDeskCaption, miniAppBetUrl, type HotDeskCopy } from "./post.ts";
import { acceptedPair, acceptedStoryPicks } from "./editor.ts";
import { EMPTY_STATE, hotDeskPolicy, marketResting, needsEvaluation, publicationBlock, recordPost, storyAlreadyPosted, type HotDeskState } from "./state.ts";
import { priceChartSvg } from "./card.ts";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 36e5).toUTCString();

test("RSS 2.0 items keep title, link and a plain-text summary within the window", () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[Russia warns NATO over Baltic drills]]></title><link>https://www.bbc.com/news/a</link><description><![CDATA[<p>Moscow said the drills &amp; deployments were a &quot;provocation&quot;.</p>]]></description><pubDate>${hoursAgo(1)}</pubDate></item>
    <item><title>An old story about the Baltic drills</title><link>https://www.bbc.com/news/b</link><pubDate>${hoursAgo(30)}</pubDate></item>
  </channel></rss>`;
  const [headline, ...rest] = parseHeadlines(xml, { publisher: "BBC", url: "https://feeds.bbci.co.uk/x" }, NOW);
  assert.equal(rest.length, 0);
  assert.equal(headline!.title, "Russia warns NATO over Baltic drills");
  assert.equal(headline!.description, 'Moscow said the drills & deployments were a "provocation".');
  assert.equal(headline!.outlet, "BBC");
});

test("RSS 1.0 items read dc:date and Google News items carry the original outlet", () => {
  const rdf = `<rdf:RDF><item rdf:about="https://www.dw.com/en/a"><title>EU agrees new sanctions package on Russia</title><link>https://www.dw.com/en/a</link><dc:date>${new Date(NOW - 36e5).toISOString()}</dc:date></item></rdf:RDF>`;
  assert.equal(parseHeadlines(rdf, { publisher: "DW", url: "https://rss.dw.com/x" }, NOW)[0]?.title, "EU agrees new sanctions package on Russia");
  const google = `<rss><channel><item><title>Iran rejects US proposal on nuclear talks - Reuters</title><link>https://news.google.com/rss/articles/x</link><pubDate>${hoursAgo(2)}</pubDate><description>&lt;ol&gt;&lt;li&gt;links&lt;/li&gt;&lt;/ol&gt;</description><source url="https://www.reuters.com">Reuters</source></item></channel></rss>`;
  const [item] = parseHeadlines(google, { publisher: "Google News", url: "https://news.google.com/x", aggregator: true }, NOW);
  assert.deepEqual([item!.outlet, item!.title, item!.description, item!.topStory], ["Reuters", "Iran rejects US proposal on nuclear talks", "", true]);
});

test("the same story from several outlets forms one cluster whose coverage counts outlets", () => {
  const headline = (outlet: string, title: string): Headline => ({ outlet, title, description: "", url: "https://example.com", publishedAt: new Date(NOW - 36e5).toISOString(), topStory: false });
  const clusters = clusterHeadlines([
    headline("BBC", "Russian drones enter Polish airspace, NATO jets scrambled"),
    headline("Reuters", "NATO scrambles jets as Russian drones enter Polish airspace"),
    headline("Reuters", "Polish airspace violated by Russian drones, NATO jets respond"),
    headline("Guardian", "Brazil votes in presidential runoff between Lula and Bolsonaro"),
  ]);
  assert.equal(clusters[0]!.coverage, 2);
  assert.equal(clusters[0]!.titles.length, 3);
  assert.equal(clusters[1]!.coverage, 1);
  assert.ok(sameStory(clusters[0]!.fingerprint, ["russian", "drone", "polish", "airspace", "nato"]));
  assert.ok(!sameStory(clusters[0]!.fingerprint, clusters[1]!.fingerprint));
});

test("word stems match across demonyms and suffixes without merging look-alike words", () => {
  for (const [left, right] of [["brazil", "brazilian"], ["vote", "voter"], ["ukraine", "ukrainian"], ["china", "chinese"], ["president", "presidential"]]) assert.ok(similarTokens(left!, right!), `${left}/${right}`);
  for (const [left, right] of [["police", "policy"], ["start", "starlink"], ["ballot", "ballon"], ["iran", "iraq"]]) assert.ok(!similarTokens(left!, right!), `${left}/${right}`);
});

const market = (patch: Partial<GammaMarket> = {}): GammaMarket => ({
  id: "3120760", question: "NATO x Russia military clash by October 31, 2026?", slug: "nato-x-russia", outcomes: '["Yes", "No"]', outcomePrices: '["0.0235", "0.9765"]',
  clobTokenIds: '["90103249718343334756773580827701144244122903469501608441410963092372041632343", "66797176836865406644675050248194264952001579179703527537"]',
  bestBid: 0.023, bestAsk: 0.024, lastTradePrice: 0.023, oneDayPriceChange: 0.12, oneWeekPriceChange: -0.07, active: true, closed: false, acceptingOrders: true, enableOrderBook: true,
  endDate: "2026-11-01T03:59:00Z", image: "https://polymarket-upload.s3.us-east-2.amazonaws.com/x.jpg", volumeNum: 4_000_000, liquidityNum: 80_000, ...patch,
});

test("only liquid, open binary markets become hot-desk markets with Polymarket's chance and buy prices", () => {
  const normalized = normalizeMarket(market(), { title: "NATO x Russia military clash by...?", slug: "nato-x-russia-military-clash" }, undefined, NOW)!;
  assert.equal(normalized.chance, 0.0235);
  assert.equal(normalized.yesPrice, 0.024);
  assert.ok(Math.abs(normalized.noPrice - 0.977) < 1e-9);
  assert.equal(normalized.eventTitle, "NATO x Russia military clash by...?");
  for (const patch of [
    { outcomes: '["Lula", "Bolsonaro"]' }, { closed: true }, { acceptingOrders: false }, { enableOrderBook: false }, { clobTokenIds: "[]" },
    { volumeNum: 10_000, liquidityNum: 1_000 }, { bestBid: 0.1, bestAsk: 0.3 }, { bestBid: 0.995, bestAsk: 0.997 },
    { endDate: new Date(NOW + 2 * 36e5).toISOString() },
  ] as Partial<GammaMarket>[]) assert.equal(normalizeMarket(market(patch), null, undefined, NOW), null, JSON.stringify(patch));
  // Election markets keep trading past their scheduled end date.
  assert.ok(normalizeMarket(market({ endDate: "2026-10-05T03:59:00Z" }), null, undefined, NOW));
  // Search payloads have no best bid; the spread recovers it.
  assert.ok(Math.abs(normalizeMarket(market({ bestBid: undefined, spread: 0.002 }), null, undefined, NOW)!.noPrice - 0.978) < 1e-9);
});

test("buttons open the Mini App with m<market id>_<side> and show both buy prices", () => {
  assert.equal(miniAppBetUrl("3120760", 0), "https://t.me/DropsAnalyticsAIbot?startapp=m3120760_0&mode=compact");
  assert.throws(() => miniAppBetUrl("abc", 1));
  const prices = { id: "601826", yesPrice: 0.23, noPrice: 0.78 };
  assert.deepEqual(betKeyboard(prices, "en"), { inline_keyboard: [[
    { text: "✅ Yes · 23%", url: "https://t.me/DropsAnalyticsAIbot?startapp=m601826_0&mode=compact" },
    { text: "❌ No · 78%", url: "https://t.me/DropsAnalyticsAIbot?startapp=m601826_1&mode=compact" },
  ]] });
  assert.deepEqual(betKeyboard({ ...prices, yesPrice: 0.024, noPrice: 0.977 }, "ru").inline_keyboard[0]!.map(button => button.text), ["✅ Да · 2,4%", "❌ Нет · 97,7%"]);
  assert.deepEqual([formatPercent(0.0235), formatPercent(0.5), formatPercent(0.0996)], ["2.4%", "50%", "10%"]);
});

const COPY: HotDeskCopy = {
  category: "geopolitics",
  titleEn: "Russian drones cross into Poland as NATO scrambles jets",
  titleRu: "Российские дроны залетели в Польшу — НАТО подняло истребители",
  contextEn: "Polish officials said several drones entered the country's airspace overnight & allied jets were scrambled.",
  contextRu: "По данным польских властей, ночью несколько дронов вошли в воздушное пространство страны; союзники подняли авиацию.",
  marketQuestionRu: "Военное столкновение НАТО и России до 31 октября 2026 года?",
};

test("captions carry the headline, context, market odds and the 24-hour move only when it is at least a point", () => {
  const caption = hotDeskCaption(COPY, { question: "NATO x Russia military clash by October 31, 2026?", chance: 0.23, dayChange: 0.12 }, "ru");
  assert.equal(caption, "⚡️ <b>Российские дроны залетели в Польшу — НАТО подняло истребители</b>\n\nПо данным польских властей, ночью несколько дронов вошли в воздушное пространство страны; союзники подняли авиацию.\n\n📊 Военное столкновение НАТО и России до 31 октября 2026 года?\nДа — <b>23%</b> · ▲ +12 п.п. за сутки\n\nСтавка в один тап 👇");
  const english = hotDeskCaption(COPY, { question: "NATO x Russia military clash by October 31, 2026?", chance: 0.23, dayChange: 0.004 }, "en");
  assert.ok(english.includes("Yes — <b>23%</b>\n\nOne-tap bet 👇"));
  assert.ok(english.includes("overnight &amp; allied"));
  assert.equal(formatChange(-0.071, "en"), "▼ −7 pp in 24h");
  assert.equal(formatChange(0.004, "ru"), null);
});

test("writer copy is rejected when a field is missing, too long, in the wrong language or carries links", () => {
  assert.deepEqual(copyProblems(COPY), []);
  assert.ok(copyProblems({ ...COPY, titleRu: "Russian drones cross into Poland as NATO scrambles jets" }).some(problem => problem.startsWith("titleRu")));
  assert.ok(copyProblems({ ...COPY, contextEn: "x".repeat(300) }).some(problem => problem.startsWith("contextEn")));
  assert.ok(copyProblems({ ...COPY, contextEn: "Read more at https://example.com about the drones over Poland." }).some(problem => problem.includes("links")));
  assert.ok(copyProblems({ ...COPY, category: "sports" as never }).includes("category: unknown"));
});

test("only real, hot story picks and confident, valid pairs pass the editor gates", () => {
  const clusters = clusterHeadlines([{ outlet: "BBC", title: "Russian drones enter Polish airspace, NATO jets scrambled", description: "Drones crossed overnight.", url: "https://bbc.com/a", publishedAt: new Date(NOW).toISOString(), topStory: true }]);
  const picks = acceptedStoryPicks({ stories: [
    { storyId: "s1", hype: 9, category: "geopolitics", why: "Escalation", queries: ["Russia NATO", "x", "Poland drones"] },
    { storyId: "s9", hype: 10, category: "war", why: "Unknown id", queries: ["Iran"] },
    { storyId: "s1", hype: 6, category: "war", why: "Too quiet", queries: ["Russia NATO"] },
  ] }, clusters);
  assert.deepEqual(picks.map(pick => [pick.storyId, pick.queries]), [["s1", ["Russia NATO", "Poland drones"]]]);
  const candidate = normalizeMarket(market(), null, undefined, NOW)!;
  const selection = { storyId: "s1", marketId: candidate.id, confidence: 0.93, reason: "Direct escalation between the market's actors.", ...COPY };
  assert.ok(acceptedPair(selection, picks, clusters, [candidate]).pair);
  assert.match(acceptedPair({ ...selection, confidence: 0.6 }, picks, clusters, [candidate]).problems.join(), /confidence/);
  assert.match(acceptedPair({ ...selection, marketId: "999" }, picks, clusters, [candidate]).problems.join(), /marketId/);
  assert.equal(acceptedPair({ ...selection, storyId: null, marketId: null }, picks, clusters, [candidate]).pair, null);
});

test("publication waits for the interval, the daily cap and any unknown send outcome", () => {
  const policy = hotDeskPolicy({});
  assert.equal(publicationBlock(EMPTY_STATE, policy, NOW), null);
  const post = (minutesAgo: number, marketId = "1") => ({ at: new Date(NOW - minutesAgo * 60_000).toISOString(), storyTitle: "t", storyFingerprint: ["russian", "drone", "poland", "nato"], marketId, dayChange: 0.01, messages: { en: 1, ru: 2 } });
  assert.equal(publicationBlock({ lastSentAt: NOW - 30 * 60_000, posts: [post(30)] }, policy, NOW), "interval-not-due");
  assert.equal(publicationBlock({ lastSentAt: NOW - 100 * 60_000, posts: [post(100)] }, policy, NOW), null);
  const today = Array.from({ length: 8 }, (_, index) => post(100 + index * 10));
  assert.equal(publicationBlock({ lastSentAt: NOW - 100 * 60_000, posts: today }, policy, NOW), "daily-limit");
  assert.equal(publicationBlock({ ...EMPTY_STATE, pending: { marketId: "1", storyTitle: "t", attemptedAt: "", sent: { en: null, ru: null } } }, policy, NOW), "pending-outcome");
  assert.equal(hotDeskPolicy({ ODDSFRONT_HOT_DESK_MIN_INTERVAL_MINUTES: "20" }).minIntervalMinutes, 20);

  const state: HotDeskState = { lastSentAt: NOW - 60 * 60_000, posts: [post(60, "3120760")] };
  assert.ok(marketResting(state, "3120760", 0.02, policy, NOW));
  assert.ok(!marketResting(state, "3120760", -0.11, policy, NOW));
  assert.ok(!marketResting(state, "42", 0, policy, NOW));
  assert.ok(storyAlreadyPosted(state, ["russian", "drone", "poland", "airspace"], policy, NOW));
  assert.ok(!storyAlreadyPosted(state, ["brazil", "runoff", "lula", "bolsonaro"], policy, NOW));

  const recorded = recordPost({ ...state, pending: { marketId: "1", storyTitle: "t", attemptedAt: "", sent: { en: 5, ru: null } } }, post(0, "9"), NOW);
  assert.equal(recorded.pending, undefined);
  assert.equal(recorded.lastSentAt, NOW);
  assert.equal(recorded.posts.length, 2);
});

test("an unchanged news cycle needs no new editor call until it is re-evaluated", () => {
  const policy = hotDeskPolicy({});
  const story = { fingerprint: ["brazil", "runoff", "lula", "bolsonaro"], coverage: 3 };
  const state: HotDeskState = { ...EMPTY_STATE, evaluated: { at: new Date(NOW - 30 * 60_000).toISOString(), fingerprints: [story.fingerprint] } };
  assert.ok(!needsEvaluation(state, [story], policy, NOW));
  assert.ok(needsEvaluation(state, [story, { fingerprint: ["iran", "strike", "israel", "tehran"], coverage: 2 }], policy, NOW));
  assert.ok(!needsEvaluation(state, [story, { fingerprint: ["iran", "strike", "israel", "tehran"], coverage: 1 }], policy, NOW));
  assert.ok(needsEvaluation(state, [story], policy, NOW + 3 * 36e5));
  assert.ok(needsEvaluation(EMPTY_STATE, [story], policy, NOW));
});

test("the card chart needs enough history and never divides by a flat range", () => {
  assert.equal(priceChartSvg([{ t: 1, p: 0.2 }]), "");
  const flat = priceChartSvg(Array.from({ length: 10 }, (_, index) => ({ t: index * 3600, p: 0.4 })));
  assert.ok(flat.startsWith("<svg") && !flat.includes("NaN"));
});
