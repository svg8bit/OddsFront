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
    events: fixture.events.slice(0, 3).map((event, index) => ({
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

test("fresh observations renew all rolling alerts without remounting, then stale data expires", async ({ page }) => {
  await isolateActivity(page);
  const now = Date.now();
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

  payload = liveFeed(now + 9 * 60_000);
  await page.clock.setSystemTime(now + 9 * 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(rail).toHaveAttribute("data-feed-updated-at", payload.updatedAt);
  await expect(rail.locator(`[data-notice-id="${id}"]`)).toHaveAttribute("data-qa-preserved", "true");
  await page.clock.fastForward(65_000);
  await expect(rail).toHaveAttribute("data-activity-count", "3");

  await rail.getByRole("button", { name: "Dismiss activity notification" }).first().click();
  await expect(rail).toHaveAttribute("data-activity-count", "2");
  payload = liveFeed(now + 11 * 60_000);
  await page.clock.setSystemTime(now + 11 * 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(rail).toHaveAttribute("data-feed-updated-at", payload.updatedAt);
  await expect(rail).toHaveAttribute("data-activity-count", "2");

  status = 503;
  await page.clock.fastForward(11 * 60_000);
  await expect(rail).toHaveCount(0);
});
