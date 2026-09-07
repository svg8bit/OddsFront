import { expect, test } from "@playwright/test";
import { xNewsArticle, xNewsPayload } from "../lib/news/x-publication";
import type { NewsArticle } from "../lib/news/types";
import seed from "../lib/news/catalog.seed.json";

test("X posts the same fresh selection once with only the exact title and canonical link", () => {
  const now = Date.now();
  const article = { ...(seed.articles[0] as NewsArticle), id: "development-x-selection", publishedAt: new Date(now - 60_000).toISOString() };
  expect(xNewsArticle([article], [article.id], [], now)?.id).toBe(article.id);
  expect(xNewsArticle([article], [article.id], [article.id], now)).toBeNull();
  expect(xNewsArticle([article], [article.id, "unknown-new-edition"], [], now)).toBeNull();
  expect(xNewsArticle([article], [article.id], [], now + 4 * 3_600_000)).toBeNull();
  expect(xNewsPayload(article).text).toBe(`🗞 ${article.title}\nhttps://oddsfront.com/news/${article.countries[0]!.toLowerCase()}/${article.slug}`);
  expect(() => xNewsPayload({ ...article, title: "x".repeat(300) })).toThrow();
});
