import { expect, test } from "@playwright/test";
import { xNewsArticle, xNewsCoverUrl, xNewsPayload, verifyXPhotoPost } from "../lib/news/x-publication";
import type { NewsArticle } from "../lib/news/types";
import seed from "../lib/news/catalog.seed.json";

test("X posts the same fresh selection once with only the exact title and a separate cover", () => {
  const now = Date.now();
  const article = { ...(seed.articles[0] as NewsArticle), id: "development-x-selection", publishedAt: new Date(now - 60_000).toISOString() };
  expect(xNewsArticle([article], [article.id], [], now)?.id).toBe(article.id);
  expect(xNewsArticle([article], [article.id], [article.id], now)).toBeNull();
  expect(xNewsArticle([article], [article.id, "unknown-new-edition"], [], now)).toBeNull();
  expect(xNewsArticle([article], [article.id], [], now + 7 * 3_600_000)).toBeNull();
  expect(xNewsPayload(article).text).toBe(`🗞 ${article.title}`);
  expect(xNewsCoverUrl(article)).toBe(`https://oddsfront.com/social/news/en/${article.slug}?v=${encodeURIComponent(article.updatedAt)}`);
  expect(() => xNewsPayload({ ...article, title: "x".repeat(300) })).toThrow();
  expect(() => xNewsPayload({ ...article, title: "A headline https://example.com" })).toThrow();
});

test("X verification requires the selected photo and rejects external links or another author", () => {
  const expected = { postId: "1234", accountId: "5678", mediaKey: "3_9012", text: "🗞 Development headline" };
  const post = { data: { id: expected.postId, author_id: expected.accountId, text: expected.text, attachments: { media_keys: [expected.mediaKey] } }, includes: { media: [{ media_key: expected.mediaKey, type: "photo" }] } };
  expect(() => verifyXPhotoPost(post, expected)).not.toThrow();
  expect(() => verifyXPhotoPost({ ...post, data: { ...post.data, author_id: "wrong-account" } }, expected)).toThrow();
  expect(() => verifyXPhotoPost({ ...post, data: { ...post.data, attachments: { media_keys: [] } } }, expected)).toThrow();
  const photo = { ...post, data: { ...post.data, text: `${expected.text} https://t.co/development`, entities: { urls: [{ url: "https://t.co/development", expanded_url: "https://x.com/alotofbit/status/1234/photo/1" }] } } };
  expect(() => verifyXPhotoPost(photo, expected)).not.toThrow();
  photo.data.entities.urls[0]!.expanded_url = "https://oddsfront.com/news";
  expect(() => verifyXPhotoPost(photo, expected)).toThrow("external link");
});
