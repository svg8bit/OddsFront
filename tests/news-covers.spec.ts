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
    expect(requests).toContain("https://feeds.skynews.com/feeds/rss/uk.xml");
    expect(requests).toContain(photo);
    expect(requests).not.toContain(article);
  } finally { globalThis.fetch = original; }
});

test("a stalled unmatched Sky feed cannot prevent a later section's valid photo", async () => {
  const article = "https://news.sky.com/story/politics-development-fixture";
  const photo = "https://e3.365dm.com/politics-fixture.jpg";
  const original = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/uk.xml")) return new Promise<Response>((_, reject) => {
      init!.signal!.addEventListener("abort", () => { cancelled = true; reject(new Error("cancelled fixture")); }, { once: true });
    });
    const response = url.endsWith("/politics.xml") ? new Response(`<rss><item><link>${article}</link><enclosure url="${photo}"/></item></rss>`)
      : url === photo ? new Response(new Uint8Array([255, 216, 255, 217]), { headers: { "Content-Type": "image/jpeg" } })
        : new Response("<rss></rss>");
    Object.defineProperty(response, "url", { value: url }); return response;
  };
  try {
    const started = Date.now();
    expect((await fetchPartnerCover(article))?.imageUrl).toBe(photo);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(cancelled).toBe(true);
  } finally { globalThis.fetch = original; }
});

test("an unusable Sky enclosure retains the canonical article image fallback", async () => {
  const article = "https://news.sky.com/story/fallback-development-fixture";
  const stale = "https://e3.365dm.com/stale-fixture.jpg";
  const photo = "https://e3.365dm.com/canonical-fixture.jpg";
  const requests: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input); requests.push(url);
    const response = url.endsWith(".xml") ? new Response(`<rss><item><link>${article}</link><enclosure url="${stale}"/></item></rss>`)
      : url === article ? new Response(`<meta property="og:image" content="${photo}">`, { headers: { "Content-Type": "text/html" } })
        : url === photo ? new Response(new Uint8Array([255, 216, 255, 217]), { headers: { "Content-Type": "image/jpeg" } })
          : new Response("missing", { status: 404 });
    Object.defineProperty(response, "url", { value: url }); return response;
  };
  try {
    expect((await fetchPartnerCover(article))?.imageUrl).toBe(photo);
    expect(requests.filter(url => url === stale)).toHaveLength(1);
    expect(requests).toContain(article);
  } finally { globalThis.fetch = original; }
});

test("editions retain at most three fallback covers and replace the remainder", async () => {
  const articles = Array.from({ length: 20 }, (_, i) => ({ ...seed.articles[0], id: String(i), sources: [{ ...seed.articles[0].sources[0], kind: "media", url: `https://www.axios.com/development-${i}` }] })) as NewsArticle[];
  const photo = { body: new ArrayBuffer(8), contentType: "image/jpeg", imageUrl: "https://images.axios.com/development.jpg" };
  const five = await prepareEditionCovers(articles, async url => Number(url.split('-').at(-1)) < 16 ? photo : null);
  expect(five.accepted).toHaveLength(19);
  expect(five.rejected.map(article => article.id)).toEqual(["19"]);
  expect(five.accepted.filter(article => !article.cover)).toHaveLength(3);
  const six = await prepareEditionCovers(articles, async url => Number(url.split('-').at(-1)) < 17 ? photo : null);
  expect(six.accepted).toHaveLength(20);
  expect(six.rejected).toEqual([]);
});
