import { expect, test } from "@playwright/test";
import { extractPartnerFeedImage, extractPartnerOpenGraphImage, normalizePartnerImageUrl, fetchPartnerCover } from "../lib/news/partner-covers";
import { prepareEditionCovers } from "../lib/news/edition-covers";
import type { NewsArticle } from "../lib/news/types";
import seed from "../lib/news/catalog.seed.json";

test("publisher title cards use OddsFront artwork while real photographs remain eligible", () => {
  expect(normalizePartnerImageUrl("https://meduza.io/imgly/share/123/news/example")).toBeNull();
  expect(extractPartnerOpenGraphImage('<meta property="og:image" content="https://meduza.io/imgly/share/123/news/example">', "https://meduza.io/news/example")).toBeNull();
  expect(normalizePartnerImageUrl("https://images.euronews.com/articles/photo.jpg")).toBeTruthy();
  expect(normalizePartnerImageUrl("https://meduza.io/image/attachments/photo.jpg")).toBeTruthy();
  expect(normalizePartnerImageUrl("https://images.euronews.com.evil.example/photo.jpg")).toBeNull();
});

test("RSS cover discovery requires the exact article and an approved image host", () => {
  const article = "https://news.sky.com/story/development-fixture";
  const rss = '<rss><item><link>https://news.sky.com/story/unrelated</link><enclosure url="https://e3.365dm.com/wrong.jpg"/></item><item><link>' + article + '</link><media:content url="https://e3.365dm.com/correct.jpg?a=1&amp;b=2"/></item></rss>';
  expect(extractPartnerFeedImage(rss, article)).toBe("https://e3.365dm.com/correct.jpg?a=1&b=2");
  expect(extractPartnerFeedImage(rss, article + "-different")).toBeNull();
});

test("Sky domestic stories retain their own photograph when absent from the World feed", async () => {
  const article = "https://news.sky.com/story/domestic-development-fixture";
  const photo = "https://e3.365dm.com/domestic-fixture.jpg";
  const requests: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input); requests.push(url);
    const response = url.endsWith("/world.xml") ? new Response("unavailable", { status: 503 })
      : url.endsWith("/uk.xml") ? new Response(`<rss><item><link>${article}</link><enclosure url="${photo}"/></item></rss>`)
        : url === photo ? new Response(new Uint8Array([255, 216, 255, 217]), { headers: { "Content-Type": "image/jpeg" } })
          : new Response("not found", { status: 404 });
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
  try {
    expect((await fetchPartnerCover(article))?.imageUrl).toBe(photo);
    expect(requests).toEqual(["https://feeds.skynews.com/feeds/rss/world.xml", "https://feeds.skynews.com/feeds/rss/uk.xml", photo]);
  } finally { globalThis.fetch = original; }
});

test("editions retain at most three fallback covers and replace the remainder", async () => {
  const articles = Array.from({ length: 9 }, (_, i) => ({ ...seed.articles[0], id: String(i), sources: [{ ...seed.articles[0].sources[0], kind: "media", url: `https://www.axios.com/development-${i}` }] })) as NewsArticle[];
  const photo = { body: new ArrayBuffer(8), contentType: "image/jpeg", imageUrl: "https://images.axios.com/development.jpg" };
  const five = await prepareEditionCovers(articles, async url => Number(url.at(-1)) < 5 ? photo : null);
  expect(five.accepted).toHaveLength(8);
  expect(five.rejected.map(article => article.id)).toEqual(["8"]);
  expect(five.accepted.filter(article => !article.cover)).toHaveLength(3);
  const six = await prepareEditionCovers(articles, async url => Number(url.at(-1)) < 6 ? photo : null);
  expect(six.accepted).toHaveLength(9);
  expect(six.rejected).toEqual([]);
});
