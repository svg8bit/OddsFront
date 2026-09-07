import { expect, test } from "@playwright/test";
import { readLiveNewsCatalog } from "../lib/news/feed-reader";
import { isNewsPublisher } from "../lib/news/sources";
import seed from "../lib/news/catalog.seed.json";

test("a temporary upstream failure retries the live catalog instead of returning seed data", async () => {
  let calls = 0;
  const catalog = { ...seed, updatedAt: new Date().toISOString(), articles: [seed.articles[0], { ...seed.articles[0], id: "qa-second", slug: "qa-second" }] };
  const request: typeof fetch = async () => ++calls === 1 ? new Response("unavailable", { status: 503 }) : Response.json(catalog);
  const result = await readLiveNewsCatalog("https://feed.example/v1/market-strip", "qa-only", request);
  expect(result.articles).toHaveLength(2); expect(calls).toBe(2);
  await expect(readLiveNewsCatalog("https://feed.example", "qa-only", async () => new Response("unavailable", { status: 503 }))).rejects.toThrow("Live news feed unavailable");
});

test("the requested publishers are accepted without allowing impersonating hosts", () => {
  for (const host of ["theguardian.com", "euronews.com", "news.sky.com", "meduza.io", "tvrain.tv"]) {
    expect(isNewsPublisher(`https://${host}/news/example`)).toBe(true);
    expect(isNewsPublisher(`https://${host}.evil.example/news/example`)).toBe(false);
  }
});
