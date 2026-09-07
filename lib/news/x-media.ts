import { createHash } from "node:crypto";
import type { NewsArticle } from "./types.ts";
import { newsArticlePath } from "./routing.ts";
import { xNewsCoverUrl } from "./x-publication.ts";
import { xRequest, type XCredentials } from "./x-client.ts";

export async function xUploadNewsCover(credentials: XCredentials, article: NewsArticle) {
  const coverUrl = xNewsCoverUrl(article);
  const page = await fetch(`https://oddsfront.com${newsArticlePath(article, "en")}`, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!page.ok || !(await page.text()).includes(`property="og:image" content="${coverUrl}"`)) throw new Error("Selected article social cover is not public yet");
  const response = await fetch(coverUrl, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/png") throw new Error("OddsFront social cover is unavailable");
  const maximum = 5 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > maximum) throw new Error("OddsFront social cover exceeds the X image limit");
  const image = Buffer.from(await response.arrayBuffer());
  if (image.length < 24 || image.length > maximum || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || image.readUInt32BE(16) !== 1200 || image.readUInt32BE(20) !== 630) throw new Error("OddsFront social cover must be a 1200 by 630 PNG");
  const result = await xRequest(credentials, "POST", "/2/media/upload", { media: image.toString("base64"), media_category: "tweet_image" });
  const media = result.data;
  if (typeof media?.id !== "string" || !/^\d+$/.test(media.id) || typeof media.media_key !== "string" || !/^\d+_\d+$/.test(media.media_key) || media.expires_after_secs <= 0 || (media.processing_info?.state && media.processing_info.state !== "succeeded")) throw new Error("X did not return a ready cover image");
  return { mediaId: media.id as string, mediaKey: media.media_key as string, coverUrl, sha256: createHash("sha256").update(image).digest("hex"), uploadedAt: new Date().toISOString() };
}
