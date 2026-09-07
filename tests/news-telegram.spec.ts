import { expect, test } from "@playwright/test";
import { approvedTelegramCandidate, telegramCandidates, telegramPayload, TELEGRAM_CHANNEL_ID } from "../lib/news/telegram";
import { getConflictPreviewFixtureFeed } from "../features/global-conflict-map/preview/fixture";
import type { NewsArticle } from "../lib/news/types";
import seed from "../lib/news/catalog.seed.json";

function fixture() {
  const now = Date.now();
  const feed = getConflictPreviewFixtureFeed();
  const article = { ...(seed.articles[0] as NewsArticle), id: "telegram-development-fixture", title: "Ukraine and Russia discuss a ceasefire", countries: ["UA", "RU"], topics: ["ceasefire"], publishedAt: new Date(now - 60_000).toISOString() };
  const event = { ...feed.events[0]!, id: "polymarket-123456", dataOrigin: "polymarket" as const, title: "Russia x Ukraine ceasefire by December 31?", countryCodes: ["RU", "UA"], marketUrl: "https://polymarket.com/event/russia-x-ukraine-ceasefire-agreement-by", marketConditionId: `0x${"1".repeat(64)}`, volume: 2_000_000, marketVolume: 2_000_000, yesOdds: 25, updatedAt: new Date(now).toISOString(), endDate: new Date(now + 86_400_000).toISOString() };
  return { article, event, feed: { ...feed, dataMode: "live" as const, updatedAt: event.updatedAt, events: [event] }, now };
}

test("Telegram excludes expired news, stale markets and articles already sent", () => {
  const { article, event, feed, now } = fixture();
  expect(telegramCandidates([article], feed, [], now)).toHaveLength(1);
  expect(telegramCandidates([article], feed, [article.id], now)).toHaveLength(0);
  expect(telegramCandidates([{ ...article, publishedAt: new Date(now - 4 * 3_600_000).toISOString() }], feed, [], now)).toHaveLength(0);
  expect(telegramCandidates([article], { ...feed, events: [{ ...event, updatedAt: new Date(now - 3_600_000).toISOString() }] }, [], now)).toHaveLength(0);
  expect(telegramCandidates([article], { ...feed, events: [{ ...event, marketVolume: 99_999 }] }, [], now)).toHaveLength(0);
});

test("Telegram keeps the actual bilateral conflict ahead of broad country-list matches", () => {
  const { article, event, feed, now } = fixture();
  const broad = Array.from({ length: 10 }, (_, index) => ({ ...event, id: `polymarket-${123457 + index}`, title: "NATO military developments?", countryCodes: ["RU", "UA", "US", "GB", "FR", "DE", "RO", "PL"], marketVolume: 10_000_000 }));
  const candidates = telegramCandidates([{ ...article, title: "Russian drones hit Ukraine's border crossing", countries: ["UA", "RU", "RO"], topics: ["drone attack"] }], { ...feed, events: [...broad, event] }, [], now);
  expect(candidates[0]?.event.id).toBe(event.id);
});

test("Telegram links, YES odds and tracking come from the selected condition with preview below", () => {
  const { article, event } = fixture();
  const selection = { articleId: article.id, eventId: event.id, confidence: .96, reason: "Both concern the same bilateral ceasefire discussions and participants." };
  expect(approvedTelegramCandidate({ ...selection, eventId: "invented-market" }, [{ article, event }])).toBeNull();
  expect(approvedTelegramCandidate({ ...selection, confidence: .8 }, [{ article, event }])).toBeNull();
  const payload = telegramPayload({ article: { ...article, title: "Ukraine <talks> & ceasefire" }, event });
  expect(payload.chat_id).toBe(TELEGRAM_CHANNEL_ID);
  expect(payload.text).toContain("Ukraine &lt;talks&gt; &amp; ceasefire");
  expect(payload.text).toContain(`${event.marketUrl}?via=drops1`);
  expect(payload.text).toContain("Yes</a> 25%");
  expect(payload.link_preview_options.show_above_text).toBe(false);
  expect(payload.link_preview_options.url).toContain("https://oddsfront.com/news/ua/");
  expect(payload.reply_markup?.inline_keyboard[0]?.[0]?.url).toContain("TRACKpm_russia-x-ukraine-ceasefire-agreement-by");
});
