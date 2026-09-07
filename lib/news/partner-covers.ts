import { isNewsPublisher } from "./sources.ts";

const MAX_HTML_BYTES = 1_500_000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const PARTNER_IMAGE_HOSTS = new Set([
  "assets.kyivindependent.com",
  "cloudfront-us-east-2.images.arcpublishing.com",
  "ichef.bbci.co.uk",
  "images.axios.com",
  "www.aljazeera.com",
  "i.guim.co.uk",
  "static.euronews.com",
  "images.euronews.com",
  "e3.365dm.com",
  "e3.365dm.com.akamaized.net",
  "meduza.io",
  "tvrain.tv",
  "static.tvrain.tv",
]);
const ALLOWED_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function decodeAttribute(value: string): string {
  return value.replace(/&(amp|#x2f|#47|quot);/gi, entity => {
    const normalized = entity.toLowerCase();
    if (normalized === "&amp;") return "&";
    if (normalized === "&quot;") return '"';
    return "/";
  });
}

export function normalizePartnerImageUrl(
  value: string,
  sourceUrl?: string,
): string | null {
  try {
    const url = new URL(decodeAttribute(value), sourceUrl);
    if (url.hostname === "meduza.io" && url.pathname.startsWith("/imgly/")) return null;
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      PARTNER_IMAGE_HOSTS.has(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function extractPartnerOpenGraphImage(
  html: string,
  sourceUrl: string,
): string | null {
  for (const match of html.matchAll(/<meta\b[^>]{0,1500}>/gi)) {
    const tag = match[0];
    const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (key !== "og:image" && key !== "twitter:image") continue;
    const value = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!value) continue;
    const imageUrl = normalizePartnerImageUrl(value, sourceUrl);
    if (imageUrl) return imageUrl;
  }
  return null;
}

async function boundedBody(response: Response, maximumBytes: number) {
  const advertisedSize = Number(response.headers.get("content-length") ?? "0");
  if (advertisedSize > 0 && advertisedSize > maximumBytes) return null;
  const body = await response.arrayBuffer();
  return body.byteLength > 0 && body.byteLength <= maximumBytes ? body : null;
}

export function extractPartnerFeedImage(xml: string, sourceUrl: string): string | null {
  for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const link = item[1].match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
    if (!link || decodeAttribute(link) !== sourceUrl) continue;
    for (const tag of item[1].matchAll(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*>/gi)) {
      const value = tag[0].match(/\burl\s*=\s*["']([^"']+)["']/i)?.[1];
      const image = value && normalizePartnerImageUrl(value, sourceUrl);
      if (image) return image;
    }
  }
  return null;
}

async function sourceImage(sourceUrl: string, signal: AbortSignal) {
  const response = await fetch(sourceUrl, {
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "OddsFront/1.0 (+https://oddsfront.com/news)" },
    next: { revalidate: 21_600 }, signal,
  });
  if (!response.ok || !isNewsPublisher(response.url) || !response.headers.get("content-type")?.toLowerCase().includes("text/html")) return null;
  const body = await boundedBody(response, MAX_HTML_BYTES);
  return body ? extractPartnerOpenGraphImage(new TextDecoder().decode(body), response.url) : null;
}

async function imageBody(imageUrl: string, signal: AbortSignal) {
  if (!normalizePartnerImageUrl(imageUrl)) return null;
  const response = await fetch(imageUrl, {
    headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" },
    cache: "no-store", signal,
  });
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
  if (!response.ok || !contentType || !ALLOWED_IMAGE_TYPES.has(contentType) || !normalizePartnerImageUrl(response.url)) return null;
  const body = await boundedBody(response, MAX_IMAGE_BYTES);
  return body ? { body, contentType, imageUrl } : null;
}

async function skyFeedCover(sourceUrl: string, parentSignal: AbortSignal) {
  const controller = new AbortController();
  // Reserve the rest of the overall ten-second budget for canonical HTML and
  // its image. An unrelated slow feed cannot consume the fallback's deadline.
  const signal = AbortSignal.any([parentSignal, controller.signal, AbortSignal.timeout(3_000)]);
  const images = new Map<string, ReturnType<typeof imageBody>>();
  const attempts = ["world", "uk", "politics", "business"].map(async section => {
    const rss = await fetch(`https://feeds.skynews.com/feeds/rss/${section}.xml`, {
      next: { revalidate: 300 }, signal,
    });
    if (!rss.ok) throw new Error("Publisher feed unavailable");
    const body = await boundedBody(rss, MAX_HTML_BYTES);
    const url = body && extractPartnerFeedImage(new TextDecoder().decode(body), sourceUrl);
    if (!url) throw new Error("Exact article is absent from this feed");
    // The same enclosure can occur in several sections. Download it once and
    // count only a validated image response as a successful discovery.
    if (!images.has(url)) images.set(url, imageBody(url, signal));
    const photo = await images.get(url);
    if (!photo) throw new Error("Feed photograph is unavailable");
    return photo;
  });
  try { return await Promise.any(attempts); }
  catch { return null; }
  finally { controller.abort(); }
}

export async function fetchPartnerCover(sourceUrl: string, savedImageUrl?: string) {
  if (!isNewsPublisher(sourceUrl)) return null;
  const signal = AbortSignal.timeout(10_000);
  try {
    if (savedImageUrl) {
      const saved = await imageBody(savedImageUrl, AbortSignal.any([signal, AbortSignal.timeout(2_000)])).catch(() => null);
      if (saved) return saved;
    }
    if (new URL(sourceUrl).hostname === "news.sky.com") {
      const photo = await skyFeedCover(sourceUrl, signal);
      if (photo) return photo;
    }
    const imageUrl = await sourceImage(sourceUrl, signal);
    return imageUrl ? await imageBody(imageUrl, signal) : null;
  } catch { return null; }
}
