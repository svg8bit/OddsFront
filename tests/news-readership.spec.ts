import { expect, test } from "@playwright/test";
import seed from "../lib/news/catalog.seed.json";
import { newsArticlePath } from "../lib/news/routing";

test("popular stories use readership instead of publication order", async ({ page }) => {
  const base = seed.articles[0];
  const articles = [
    { ...base, id: "development-new", title: "Development latest story", slug: "development-latest", views7d: 1, publishedAt: new Date().toISOString() },
    { ...base, id: "development-popular", title: "Development most-read story", slug: "development-popular", views7d: 20 },
    { ...base, id: "development-unread", title: "Development unread story", slug: "development-unread", views7d: 0 },
  ];
  await page.route(/\/api\/news(?:\?.*)?$/, route => route.fulfill({ json: { updatedAt: new Date().toISOString(), articles } }));
  await page.goto("/news");
  const popular = page.getByRole("complementary", { name: "The Most Popular" });
  await expect(popular.getByRole("heading").first()).toHaveText("Development most-read story");
  await expect(popular.getByRole("link")).toHaveCount(2);
  await expect(page.locator("[data-cover-state] h2").first()).toHaveText("Development latest story");
});

test("only visible article reading counts and changing language does not count twice", async ({ page }) => {
  await page.clock.install();
  const bodies: unknown[] = [];
  await page.route("**/api/news/*/view", async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.goto(newsArticlePath(seed.articles[0], "en"));
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }));
  await page.clock.runFor(6_000);
  expect(bodies).toHaveLength(0);
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }));
  await page.clock.runFor(5_000);
  await expect.poll(() => bodies.length).toBe(1);
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith("oddsfront:read:")))).toBe(true);
  await page.goto(newsArticlePath(seed.articles[0], "ru"));
  await page.clock.runFor(8_000);
  expect(bodies).toHaveLength(1);
});

test("public readership requests reject other origins and invalid data", async ({ request, baseURL }) => {
  const url = `/api/news/${seed.articles[0].slug}/view`;
  expect((await request.post(url, { headers: { Origin: "https://outside.example" }, data: { sessionId: "not-valid" } })).status()).toBe(403);
  const headers = { Origin: new URL(baseURL!).origin, "User-Agent": "Development test reader" };
  expect((await request.post(url, { headers, data: { sessionId: "not-valid" } })).status()).toBe(400);
  expect((await request.post(url, { headers, data: { sessionId: "x".repeat(1000) } })).status()).toBe(413);
});
