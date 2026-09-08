import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { xNewsCoverUrl } from "../lib/news/x-publication";
import { xUploadNewsCover } from "../lib/news/x-media";
import type { NewsArticle } from "../lib/news/types";
import seed from "../lib/news/catalog.seed.json";

const credentials = { apiKey: "development-key", apiSecret: "development-secret", accessToken: "development-token", accessSecret: "development-token-secret" };
const article = { ...(seed.articles[0] as NewsArticle), id: "development-image-post" };

test("X uploads the article's branded social image as a photo without publishing a link", async () => {
  const originalFetch = globalThis.fetch;
  const coverUrl = xNewsCoverUrl(article);
  const png = await sharp({ create: { width: 1200, height: 630, channels: 3, background: "#6456ff" } }).png().toBuffer();
  const uploaded: Record<string, unknown>[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === coverUrl) return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
      if (url.startsWith("https://oddsfront.com/en/news/")) return new Response(`<meta property="og:image" content="${coverUrl}">`);
      expect(url).toBe("https://api.x.com/2/media/upload");
      uploaded.push(JSON.parse(String(init?.body)));
      return Response.json({ data: { id: "123456", media_key: "3_123456", expires_after_secs: 86400 } });
    };
    const result = await xUploadNewsCover(credentials, article);
    expect(result).toMatchObject({ mediaId: "123456", mediaKey: "3_123456", coverUrl });
    expect(uploaded).toEqual([{ media: png.toString("base64"), media_category: "tweet_image" }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("X blocks a missing or invalid cover before any upload or post request", async () => {
  const originalFetch = globalThis.fetch;
  const coverUrl = xNewsCoverUrl(article);
  try {
    for (const mode of ["page-mismatch", "unavailable-image", "invalid-png"] as const) {
      const externalCalls: string[] = [];
      globalThis.fetch = async input => {
        const url = String(input);
        if (url === coverUrl) return mode === "unavailable-image" ? new Response("temporarily unavailable", { status: 503 }) : new Response(new Uint8Array(24), { headers: { "content-type": "image/png" } });
        if (url.startsWith("https://oddsfront.com/en/news/")) return new Response(mode === "page-mismatch" ? "<html>stale article</html>" : `<meta property="og:image" content="${coverUrl}">`);
        externalCalls.push(url);
        return Response.json({});
      };
      await expect(xUploadNewsCover(credentials, article)).rejects.toThrow();
      expect(externalCalls).toEqual([]);
    }
  } finally { globalThis.fetch = originalFetch; }
});
