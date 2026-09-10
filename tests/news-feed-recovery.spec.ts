import { expect, test } from "@playwright/test";
import { readLiveNewsCatalog } from "../lib/news/feed-reader";
import { isNewsPublisher } from "../lib/news/sources";
import seed from "../lib/news/catalog.seed.json";
import { createNewsCatalogCache } from "../lib/news/catalog-cache";
import { newsIndexPage, newsOverviewProps, NEWS_INDEX_PAGE_SIZE } from "../lib/news/index-page";
import type { NewsCatalog } from "../lib/news/types";

test("catalogs exceeding the Next cache limit refresh once and retain good data through failures", async () => {
  let now = Date.now(); let calls = 0; let fail = false;
  let source: NewsCatalog = { ...seed, updatedAt: new Date(now).toISOString(), marketTranslations: { en: { development: "x".repeat(3 * 1024 * 1024) } } } as NewsCatalog;
  const read = createNewsCatalogCache(async () => { calls++; if (fail) throw new Error("Development upstream outage"); return source; }, () => now);
  const results = await Promise.all(Array.from({ length: 8 }, () => read()));
  expect(calls).toBe(1); expect(results.every(value => value === source)).toBe(true);
  now += 31_000;
  source = { ...source, updatedAt: new Date(now).toISOString(), articles: [{ ...source.articles[0], id: "development-new-edition" }] };
  expect((await read()).articles[0].id).toBe("development-new-edition"); expect(calls).toBe(2);
  fail = true; now += 31_000;
  expect(await read()).toBe(source); expect(calls).toBe(3);
  expect(await read()).toBe(source); expect(calls).toBe(3);
  fail = false; now += 5_001;
  const latest = source;
  source = { ...source, updatedAt: "2020-01-01T00:00:00Z" };
  expect(await read()).toBe(latest);
  now += 5_001; source = { ...latest, updatedAt: new Date(now).toISOString() };
  expect(await read()).toBe(source);
});

test("an empty worker retries after an initial load failure instead of caching seed or rejection", async () => {
  let failed = true;
  const read = createNewsCatalogCache(() => { if (failed) throw new Error("Development connection failure"); return Promise.resolve(seed as NewsCatalog); });
  await expect(read()).rejects.toThrow("Development connection failure");
  failed = false;
  expect(await read()).toBe(seed);
});

test("public pages remain bounded while full-archive search, popularity and article history remain available", () => {
  const articles = Array.from({ length: 1_000 }, (_, index) => ({ ...seed.articles[0], id: `development-${index}`, slug: `development-${index}`, title: `Development article ${index}`, publishedAt: new Date(Date.UTC(2026, 8, 10) - index * 60_000).toISOString(), views7d: index === 900 ? 99 : 0 }));
  articles[900] = { ...articles[900], title: "Development archive-only discovery", translations: { ...articles[900].translations, ru: { title: "Проверочная находка в архиве", description: "Тест поиска", body: [] } } };
  const catalog = { ...seed, articles } as NewsCatalog;
  const first = newsIndexPage(catalog);
  expect(first.articles).toHaveLength(NEWS_INDEX_PAGE_SIZE); expect(first.total).toBe(1_000);
  expect(first.popular[0].id).toBe("development-900");
  const second = newsIndexPage(catalog, { offset: first.nextOffset! });
  expect(second.articles.some(article => first.articles.some(previous => previous.id === article.id))).toBe(false);
  expect(newsIndexPage(catalog, { query: "archive-only" }).articles[0].id).toBe("development-900");
  expect(newsIndexPage(catalog, { query: "находка", locale: "ru" }).articles[0].id).toBe("development-900");
  expect(newsIndexPage(catalog, { offset: -1 }).articles).toEqual(first.articles);
  expect(newsIndexPage(catalog, { offset: 999 }).nextOffset).toBeNull();
  expect(newsOverviewProps(catalog).initialArticles).toHaveLength(NEWS_INDEX_PAGE_SIZE);
  expect(JSON.stringify(first).length).toBeLessThan(1_000_000);
  expect(catalog.articles).toHaveLength(1_000);
});

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

test("a restored feed cannot roll the catalog back behind the bundled edition", async () => {
  const old = { ...seed, updatedAt: "2020-01-01T00:00:00Z" };
  await expect(readLiveNewsCatalog("https://feed.example", "qa-only", async () => Response.json(old), seed.updatedAt)).rejects.toThrow("Live news feed unavailable");
  expect((await readLiveNewsCatalog("https://feed.example", "qa-only", async () => Response.json(seed), seed.updatedAt)).updatedAt).toBe(seed.updatedAt);
});
