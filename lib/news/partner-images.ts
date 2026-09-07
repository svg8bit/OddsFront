import "server-only";

import { isNewsPublisher } from "@/lib/news/sources";

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

export async function fetchPartnerCover(sourceUrl: string) {
  if (!isNewsPublisher(sourceUrl)) return null;
  try {
    const sourceResponse = await fetch(sourceUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "OddsFront/1.0 (+https://oddsfront.com/news)",
      },
      next: { revalidate: 21_600 },
      signal: AbortSignal.timeout(5_000),
    });
    if (
      !sourceResponse.ok ||
      !isNewsPublisher(sourceResponse.url) ||
      !sourceResponse.headers.get("content-type")?.toLowerCase().includes("text/html")
    ) return null;
    const sourceBody = await boundedBody(sourceResponse, MAX_HTML_BYTES);
    if (!sourceBody) return null;
    const imageUrl = extractPartnerOpenGraphImage(
      new TextDecoder().decode(sourceBody),
      sourceResponse.url,
    );
    if (!imageUrl) return null;

    const imageResponse = await fetch(imageUrl, {
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const contentType = imageResponse.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
    if (
      !imageResponse.ok ||
      !contentType ||
      !ALLOWED_IMAGE_TYPES.has(contentType) ||
      normalizePartnerImageUrl(imageResponse.url) === null
    ) return null;
    const body = await boundedBody(imageResponse, MAX_IMAGE_BYTES);
    return body ? { body, contentType } : null;
  } catch {
    return null;
  }
}
