import { expect, test } from "@playwright/test";
import { approvedTelegramCandidate, freshEditionArticles, russianTelegramArticle, telegramCandidates, telegramPayload, TELEGRAM_CHANNEL_ID, TELEGRAM_CHANNELS } from "../lib/news/telegram";
import { validateRussianEditorialTranslation } from "../lib/news/russian-editorial";
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

test("hourly social slots can select different stories from one two-hour site edition", () => {
  const { article, now } = fixture();
  const edition = Array.from({ length: 9 }, (_, i) => ({ ...article, id: `qa-edition-${i}` }));
  expect(freshEditionArticles(edition, [], now)).toHaveLength(9);
  expect(freshEditionArticles(edition, [edition[3]!.id], now + 3_600_000)).toHaveLength(8);
  const next = edition.map((item, i) => ({ ...item, id: `qa-next-edition-${i}`, publishedAt: new Date(now + 2 * 3_600_000).toISOString() }));
  expect(freshEditionArticles([...next, ...edition], [edition[3]!.id], now + 2 * 3_600_000)).toHaveLength(9);
});

test("Telegram excludes expired news, stale markets and articles already sent", () => {
  const { article, event, feed, now } = fixture();
  expect(telegramCandidates([article], feed, [], now)).toHaveLength(1);
  expect(telegramCandidates([article], feed, [article.id], now)).toHaveLength(0);
  expect(telegramCandidates([{ ...article, publishedAt: new Date(now - 7 * 3_600_000).toISOString() }], feed, [], now)).toHaveLength(0);
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

test("social publication prioritizes attacks in the latest nine and supports news without a forced market", async () => {
  const { freshEditionArticles, telegramSelectionPrompt } = await import("../lib/news/telegram");
  const { article, now } = fixture();
  const general = { ...article, id: "general-fixture", title: "Election results announced", topics: ["elections"] };
  const strike = { ...article, id: "strike-fixture", title: "Drones strike a border crossing", topics: ["strikes"] };
  const edition = freshEditionArticles([general, strike], [], now);
  expect(edition[0]?.id).toBe(strike.id);
  expect(telegramSelectionPrompt([], edition)).toContain("Return eventId null");
  const payload = telegramPayload({ article: general, event: null });
  expect(payload.text).toContain(general.title);
  expect(payload.text).not.toContain("Yes");
  expect(payload.reply_markup).toBeUndefined();
  expect(payload.link_preview_options.show_above_text).toBe(false);
});

test("Russian channel uses Russian copy, localized preview and the same live condition links", () => {
  const { article, event } = fixture();
  const russian = { ...article, translations: { ru: { title: "Украина и Россия обсуждают прекращение огня", description: "Продолжаются переговоры о прекращении огня.", body: [], editorReviewed: true } } };
  const payload = telegramPayload({ article: russian, event }, "ru", { [event.title]: "Прекратят ли Россия и Украина огонь к 31 декабря?" });
  expect(payload.chat_id).toBe(-1004118165561);
  expect(payload.text).toContain(russian.translations.ru.title);
  expect(payload.text).toContain("Да</a> 25%");
  expect(payload.text).not.toContain(event.title);
  expect(payload.text).toContain(`${event.marketUrl}?via=drops1`);
  expect(payload.link_preview_options.url).toContain("https://oddsfront.com/ru/news/ua/");
  expect(payload.link_preview_options.show_above_text).toBe(false);
  expect(payload.reply_markup?.inline_keyboard[0]?.[0]?.text).toBe("Отслеживать в DropsBot");
  expect(payload.reply_markup?.inline_keyboard[0]?.[0]?.url).toBe(telegramPayload({ article, event }).reply_markup?.inline_keyboard[0]?.[0]?.url);
  expect(TELEGRAM_CHANNELS.ru.directory).not.toBe(TELEGRAM_CHANNELS.en.directory);
  expect(() => telegramPayload({ article, event }, "ru")).toThrow("not ready");
  expect(() => telegramPayload({ article: russian, event }, "ru", { [event.title]: event.title })).toThrow("not ready");
});

test("Russian channel waits for the English choice and reviewed translation, skipping prior editions and duplicates", () => {
  const { article, now } = fixture();
  const russian = { ...article, translations: { ru: { title: "Украина и Россия обсуждают прекращение огня", description: "Продолжаются переговоры.", body: [], editorReviewed: true } } };
  const edition = Array.from({ length: 9 }, (_, index) => ({ ...russian, id: `ru-edition-${index}` }));
  const choice = edition[2]!;
  expect(russianTelegramArticle(edition, undefined, [], undefined, now)).toBeNull();
  expect(russianTelegramArticle([article], article.id, [], undefined, now)).toBeNull();
  expect(russianTelegramArticle(edition, choice.id, [], choice.publishedAt, now)).toBeNull();
  expect(russianTelegramArticle(edition, choice.id, [], new Date(now - 3_600_000).toISOString(), now)?.id).toBe(choice.id);
  expect(russianTelegramArticle(edition, choice.id, [choice.id], undefined, now)).toBeNull();
  expect(russianTelegramArticle(edition, edition[3]!.id, [choice.id], undefined, now)?.id).toBe(edition[3]!.id);
});

test("Russian editorial checks reject untranslated text and changed dates or counts", () => {
  expect(validateRussianEditorialTranslation("Will Israel strike 4 countries in 2026?", "Нанесёт ли Израиль удары по 4 странам в 2026 году?")).toContain("4");
  expect(() => validateRussianEditorialTranslation("12 deaths", "13 погибших")).toThrow("numbers");
  expect(() => validateRussianEditorialTranslation("12 deaths", "12 deaths")).toThrow("invalid");
  expect(() => validateRussianEditorialTranslation("ceasefire", "Прекращение огня в 2027 году")).toThrow("numbers");
});
