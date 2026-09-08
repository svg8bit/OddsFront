import { expect, test, type Page } from "@playwright/test";

import { getConflictPreviewFixtureFeed } from "../features/global-conflict-map/preview/fixture";
import type { ConflictPreviewFeed } from "../features/global-conflict-map/preview/types";

function liveFeed(timestamp: number): ConflictPreviewFeed {
  const fixture = getConflictPreviewFixtureFeed();
  return {
    ...fixture,
    dataMode: "live",
    refreshSeconds: 60,
    updatedAt: new Date(timestamp).toISOString(),
    // Two pages of three: expiry must be able to reveal different markets.
    events: fixture.events.slice(0, 6).map((event, index) => ({
      ...event,
      id: `polymarket-${880000 + index}`,
      marketConditionId: `0x${(880000 + index).toString(16).padStart(64, "0")}`,
      marketUrl: `https://polymarket.com/event/qa-freshness-${index}`,
      dataOrigin: "polymarket",
      endDate: new Date(timestamp + 86_400_000).toISOString(),
      updatedAt: new Date(timestamp).toISOString(),
      volume: 2_000_000,
      volume24h: 100_000,
      priceChange24h: 0.12 + index * 0.05,
      recentPriceMove: { changePoints: 12 + index * 5, occurredAt: new Date(timestamp).toISOString(), fromProbability: .5, toProbability: .62 + index * .05 },
      priceChange7d: 0,
    })),
  };
}

async function isolateActivity(page: Page) {
  await page.route("**/api/global-conflict-activity?**", (route) => route.fulfill({
    json: { dataMode: "live", updatedAt: new Date().toISOString(), expiresAfterSeconds: 900, items: [] },
  }));
  await page.route("https://tiles.openfreemap.org/**", (route) => route.fulfill({
    contentType: "application/x-protobuf", body: Buffer.alloc(0),
  }));
  await page.emulateMedia({ reducedMotion: "reduce" });
}

test("does not present an old snapshot as fresh on entry", async ({ page }) => {
  await isolateActivity(page);
  let payload = liveFeed(Date.now() - 60 * 60_000);
  await page.route("**/api/global-conflict-events", (route) => route.fulfill({ json: payload }));
  await page.goto("/global-conflict-map-preview");
  const layer = page.locator("[data-activity-feed-updated-at]");
  await expect(layer).toHaveAttribute("data-activity-feed-updated-at", payload.updatedAt);
  const rail = page.getByRole("complementary", { name: "Live market activity" });
  await expect(rail).toHaveCount(0);
  payload = liveFeed(Date.now());
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(rail).toHaveAttribute("data-activity-count", "3");
});

test("refreshes on mobile restore and preserves good data on old or failed responses", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await isolateActivity(page);
  const now = Date.now();
  let payload = liveFeed(now);
  let status = 200;
  let requests = 0;
  await page.route("**/api/global-conflict-events", (route) => {
    requests += 1;
    return route.fulfill({ status, json: payload });
  });
  await page.goto("/global-conflict-map-preview");
  const layer = page.locator("[data-activity-feed-updated-at]");
  await expect(layer).toHaveAttribute("data-activity-feed-updated-at", payload.updatedAt);
  const rail = page.getByRole("complementary", { name: "Live market activity" });
  await expect(rail).toHaveAttribute("data-activity-count", "3");

  payload = liveFeed(now + 1_000);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(layer).toHaveAttribute("data-activity-feed-updated-at", payload.updatedAt);
  const currentTimestamp = payload.updatedAt;

  payload = liveFeed(now - 60_000);
  let before = requests;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => requests).toBeGreaterThan(before);
  await expect(layer).toHaveAttribute("data-activity-feed-updated-at", currentTimestamp);

  status = 503;
  before = requests;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => requests).toBeGreaterThan(before);
  await expect(rail).toHaveAttribute("data-activity-count", "3");
  await expect(layer).toHaveAttribute("data-activity-feed-updated-at", currentTimestamp);

  status = 200;
  payload = liveFeed(now + 2_000);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(layer).toHaveAttribute("data-activity-feed-updated-at", payload.updatedAt);
});

test("refreshing prices preserves a display cycle and a lost feed expires the alerts", async ({ page }) => {
  await isolateActivity(page);
  const now = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  await page.clock.install({ time: now });
  let payload = liveFeed(now);
  let status = 200;
  await page.route("**/api/global-conflict-events", (route) => route.fulfill({ status, json: payload }));
  await page.goto("/global-conflict-map-preview");
  const rail = page.getByRole("complementary", { name: "Live market activity" });
  await expect(rail).toHaveAttribute("data-activity-count", "3");
  const card = rail.locator("article").first();
  const id = await card.getAttribute("data-notice-id");
  await card.evaluate((element) => element.setAttribute("data-qa-preserved", "true"));

  payload = { ...liveFeed(now + 9 * 60_000), events: payload.events };
  await page.clock.setSystemTime(now + 9 * 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(rail).toHaveAttribute("data-feed-updated-at", payload.updatedAt);
  await expect(rail.locator(`[data-notice-id="${id}"]`)).toHaveAttribute("data-qa-preserved", "true");
  await page.clock.fastForward(65_000);
  await expect(rail).toHaveAttribute("data-activity-count", "3");

  await rail.getByRole("button", { name: "Dismiss activity notification" }).first().click();
  await expect(rail).toHaveAttribute("data-activity-count", "2");
  await page.reload();
  await expect(rail).toHaveAttribute("data-activity-count", "2");
  await expect(rail.locator(`[data-notice-id="${id}"]`)).toHaveCount(0);
  payload = { ...liveFeed(now + 11 * 60_000), events: payload.events };
  await page.clock.setSystemTime(now + 11 * 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(rail).toHaveAttribute("data-feed-updated-at", payload.updatedAt);
  await expect(rail).toHaveAttribute("data-activity-count", "2");

  status = 503;
  await page.clock.fastForward(11 * 60_000);
  await expect(rail).toHaveCount(0);
});

test("a future feed timestamp cannot move the alert clock forward", async ({ page }) => {
  await isolateActivity(page);
  const now = Date.now();
  let payload = liveFeed(now);
  await page.route("**/api/global-conflict-events", route => route.fulfill({ json: payload }));
  await page.goto("/global-conflict-map-preview");
  const layer = page.locator("[data-activity-feed-updated-at]");
  const currentTimestamp = payload.updatedAt;
  await expect(layer).toHaveAttribute("data-activity-feed-updated-at", currentTimestamp);
  const cards = page.locator('[data-activity-source="rolling"]');
  await expect(cards).toHaveCount(3);
  const expiry = await cards.first().getAttribute("data-expires-at");
  payload = liveFeed(now + 60 * 60_000);
  const response = page.waitForResponse("**/api/global-conflict-events");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await response;
  await expect(layer).toHaveAttribute("data-activity-feed-updated-at", currentTimestamp);
  await expect(cards.first()).toHaveAttribute("data-expires-at", expiry!);
});

test("trade cards reject future receipts and expire within fifteen minutes even if the API advertises longer", async ({ page }) => {
  await isolateActivity(page);
  const now = Date.now();
  await page.clock.install({ time: now });
  const payload = liveFeed(now);
  await page.route("**/api/global-conflict-events", route => route.fulfill({ json: payload }));
  const items = [now - 60_000, now + 60 * 60_000, now - 16 * 60_000].map((timestamp, index) => ({
    id: `qa-receipt-${index}`, kind: "large-buy", title: `Development-only trade ${index}`, outcome: "YES", outcomeOdds: 50,
    marketConditionId: payload.events[index].marketConditionId, notional: 250_000,
    occurredAt: new Date(timestamp).toISOString(), marketUrl: payload.events[index].marketUrl,
  }));
  await page.route("**/api/global-conflict-activity?**", route => route.fulfill({ json: {
    dataMode: "live", updatedAt: new Date(now).toISOString(), expiresAfterSeconds: 1800, items,
  } }));
  await page.goto("/global-conflict-map-preview");
  const trades = page.locator('[data-activity-source="trade"]');
  await expect(trades).toHaveCount(1);
  await expect(trades).toHaveAttribute("data-notice-id", "trade-qa-receipt-0");
  await expect(trades).toHaveAttribute("data-expires-at", new Date(now + 14 * 60_000).toISOString());
  await page.clock.fastForward(14 * 60_000 + 5_000);
  await expect(trades).toHaveCount(0);
});

test("confirmed news appears alongside market alerts and expires after fifteen minutes", async ({ page }) => {
  await isolateActivity(page);
  const now = Date.now();
  await page.clock.install({ time: now });
  let payload = liveFeed(now);
  payload.events[0] = { ...payload.events[0]!, title: "Will the United States strike Iran by September 30?", countryCodes: ["US", "IR"], marketVolume: 2_000_000 };
  await page.route("**/api/global-conflict-events", route => route.fulfill({ json: payload }));
  const news = { id: "qa-news-strike", slug: "qa-news-strike", title: "United States strikes Iran after overnight attacks", countries: ["US", "IR"],
    publishedAt: new Date(now).toISOString(), alert: { kind: "strike", actorCountries: ["US"], targetCountries: ["IR"] } };
  await page.route("**/api/news", route => route.fulfill({ json: { updatedAt: new Date(now).toISOString(), articles: [news] } }));
  await page.goto("/global-conflict-map-preview");
  const rail = page.getByRole("complementary", { name: "Live market activity" });
  const card = rail.locator('[data-activity-kind="news"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText(news.title);
  await expect(card).toHaveAttribute("data-expires-at", new Date(now + 15 * 60_000).toISOString());
  await expect(card.locator("[data-activity-metric]")).toHaveCount(0);
  payload = { ...payload, updatedAt: new Date(now + 16 * 60_000).toISOString() };
  await page.clock.setSystemTime(now + 16 * 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(card).toHaveCount(0);
  await expect(rail.locator('[data-activity-source="rolling"]')).not.toHaveCount(0);
});
