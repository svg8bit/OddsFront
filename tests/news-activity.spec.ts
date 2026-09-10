import { expect, test } from "@playwright/test";
import { getConflictPreviewFixtureFeed } from "../features/global-conflict-map/preview/fixture";
import { buildNewsActivityAlerts, isMapNewsTopic, NEWS_ACTIVITY_POOL_MS, NEWS_ALERT_TTL_MS } from "../lib/news/alert-matching";
import type { NewsArticle } from "../lib/news/types";

const published = Date.parse("2026-09-08T18:00:00Z");
const iso = (time: number) => new Date(time).toISOString();
function edition(time = published): NewsArticle[] {
  return Array.from({ length: 9 }, (_, i) => ({
    id: `development-news-${i}`, slug: `development-news-${i}`,
    title: `Development fixture: Ukraine ceasefire talks report ${i}`,
    description: "Development-only verified reporting fixture.", body: [],
    countries: ["UA", "RU"], topics: ["ceasefires"], author: "Test fixture",
    publishedAt: iso(time), updatedAt: iso(time), alert: null,
    translations: { ru: { title: `Тестовая новость ${i}`, description: "Тест", body: [] } },
    sources: [
      { id: "media", kind: "media", title: "Development fixture", publisher: "Reuters", url: `https://www.reuters.com/world/test-${i}`, publishedAt: iso(time - 60_000) },
      { id: "official", kind: "official", title: "Development fixture", publisher: "United Nations", url: `https://www.un.org/test-${i}`, publishedAt: iso(time - 60_000) },
    ],
  }));
}

test("nine conflict news stories rotate once over two hours without requiring market matches", () => {
  const articles = edition();
  const seen: string[] = [];
  for (let slot = 0; slot < 8; slot++) {
    const now = published + slot * NEWS_ALERT_TTL_MS;
    const alerts = buildNewsActivityAlerts(articles, [], now);
    expect(alerts).toHaveLength(slot === 0 ? 2 : 1);
    expect(alerts.every(alert => alert.event === null && alert.publishedAt === published && alert.expiresAt === now + NEWS_ALERT_TTL_MS)).toBe(true);
    expect(buildNewsActivityAlerts([...articles].reverse(), [], now + NEWS_ALERT_TTL_MS - 1)).toEqual(alerts);
    seen.push(...alerts.map(alert => alert.article.id));
  }
  expect(new Set(seen).size).toBe(9);
  expect(buildNewsActivityAlerts(articles, [], published + NEWS_ACTIVITY_POOL_MS)).toEqual([]);
});

test("news rotation excludes withdrawals and unverified, stale or future sources and articles", () => {
  const article = edition()[0];
  for (const invalid of [
    { ...article, withdrawal: { at: iso(published), duplicateOf: "original" } },
    { ...article, publishedAt: iso(published + 1) },
    { ...article, publishedAt: "invalid" },
    { ...article, publishedAt: iso(published - NEWS_ACTIVITY_POOL_MS) },
    { ...article, sources: [] },
    { ...article, sources: article.sources.filter(source => source.kind === "media") },
    { ...article, sources: article.sources.map(source => ({ ...source, url: "https://unapproved.example/report" })) },
    { ...article, sources: article.sources.map(source => ({ ...source, publishedAt: iso(published + 61_000) })) },
    { ...article, sources: article.sources.map(source => ({ ...source, publishedAt: iso(published - 73 * 3_600_000) })) },
  ]) expect(buildNewsActivityAlerts([invalid], [], published)).toEqual([]);
  const latest = edition(published + NEWS_ALERT_TTL_MS);
  expect(buildNewsActivityAlerts([...edition(), ...latest], [], published + NEWS_ALERT_TTL_MS).every(alert => alert.publishedAt === published + NEWS_ALERT_TTL_MS)).toBe(true);
});

test("a sparse news edition is not recycled in later slots", () => {
  const articles = edition().slice(0, 1);
  expect(buildNewsActivityAlerts(articles, [], published)).toHaveLength(1);
  for (let slot = 1; slot < 8; slot++) {
    expect(buildNewsActivityAlerts(articles, [], published + slot * NEWS_ALERT_TTL_MS)).toEqual([]);
  }
});

test("news and market cards coexist, rotate, localize and retain dismissal expiry", async ({ page }) => {
  let now = published + 1_000;
  await page.clock.install({ time: now });
  const articles = edition();
  const base = getConflictPreviewFixtureFeed();
  const events = base.events.slice(0, 6).map((event, i) => ({
    ...event, id: `polymarket-${97000 + i}`, dataOrigin: "polymarket" as const,
    marketConditionId: `0x${String(i + 1).padStart(64, "0")}`,
    marketUrl: `https://polymarket.com/event/development-rotation-${i}`,
    marketVolume: 200_000, priceChange24h: i % 2 ? -.03 : .04,
    priceChange7d: i % 2 ? -.06 : .07, endDate: iso(published + 86_400_000),
  }));
  await page.route("https://tiles.openfreemap.org/planet/**", route => route.fulfill({ contentType: "application/x-protobuf", body: Buffer.alloc(0) }));
  await page.route("**/api/global-conflict-events", route => route.fulfill({ json: { ...base, events, dataMode: "live", updatedAt: iso(now) } }));
  await page.route("**/api/global-conflict-activity?**", route => route.fulfill({ json: { dataMode: "live", updatedAt: iso(now), expiresAfterSeconds: 900, items: [] } }));
  await page.route("**/api/news", route => route.fulfill({ json: { updatedAt: iso(published), articles } }));
  await page.goto("/global-conflict-map-preview", { waitUntil: "domcontentloaded" });
  const cards = page.locator("[data-activity-source]");
  const news = page.locator('[data-activity-source="news"]');
  await expect(cards).toHaveCount(3);
  await expect(news).toHaveCount(2);
  await expect(news.locator("[data-activity-actions] a")).toHaveCount(0);
  await expect(news.locator("[data-activity-metric]")).toHaveCount(0);
  await expect(news.first().locator('[data-country-flag="UA"]')).toBeVisible();
  const firstIds = await news.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-notice-id")));
  const expiry = await news.first().getAttribute("data-expires-at");
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("ru");
  await expect(news.first()).toContainText("Тестовая новость");
  await expect(news.first().locator('a[href^="/ru/news/"]')).toBeVisible();
  await expect(news.first()).toHaveAttribute("data-expires-at", expiry!);
  const dismissed = await news.first().getAttribute("data-notice-id");
  await news.first().getByRole("button").click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(news).toHaveCount(1);
  await expect(page.locator(`[data-notice-id="${dismissed}"]`)).toHaveCount(0);
  await expect(news.first()).toHaveAttribute("data-expires-at", expiry!);
  now += NEWS_ALERT_TTL_MS;
  await page.clock.fastForward(NEWS_ALERT_TTL_MS);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(cards).toHaveCount(3);
  await expect(news).toHaveCount(1);
  await expect.poll(async () => firstIds.includes(await news.first().getAttribute("data-notice-id"))).toBe(false);
  expect(firstIds).not.toContain(await news.first().getAttribute("data-notice-id"));
  expect(Date.parse(await news.first().getAttribute("data-expires-at") ?? "")).toBe(published + 2 * NEWS_ALERT_TTL_MS);
  await expect(page.locator('[data-activity-source="rolling"] time')).toHaveCount(0);
  await expect(cards.first().locator("..")).not.toContainText(/Updated|Обновлено|п\.п\.|\bpp\b/);
});


test("map news rejects unrelated reporting even when background tags mention war", () => {
  for (const title of [
    "Russian citizens return home from detained Professor Molchanov, Meduza reports",
    "Russian court gives artist's wife another 14 days in detention",
    "Egyptian presenter Sarah Khalifa plans appeal against death sentence",
    "Workers launch a labour strike over pay",
    "Drone manufacturer shares hit a record high",
    "Houthi spokesman launches a verbal attack on peace negotiators",
    "Bank reports a cyberattack on payment systems",
    "Company expands drone production plant",
    "Russia and China strike a trade agreement",
  ]) {
    const article = { ...edition()[0], title, topics: ["invasion", "ceasefire", "strikes"] };
    expect(isMapNewsTopic(article)).toBe(false);
    expect(buildNewsActivityAlerts([article], [], published)).toEqual([]);
  }
  for (const title of [
    "Israel strikes Lebanon after overnight attacks", "Russian drones attacked an airfield",
    "Ukraine reports shelling near the border", "China begins an invasion of Taiwan",
    "Troops launch a ground offensive", "Ukraine and Russia discuss a ceasefire",
    "Negotiators agree terms of a peace deal",
    "Ukrainian drones hit Makhachkala port and a theatre in Russia's Dagestan",
    "New Yemen fighting kills children as Houthi attacks trigger alerts in southern Saudi Arabia",
    "Missiles hit a military airfield overnight",
  ]) expect(isMapNewsTopic({ title, alert: null })).toBe(true);
});
