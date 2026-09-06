import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getNewsArticle } from "@/lib/news/catalog";
import { articleText, localeDirection, normalizeLocale } from "@/lib/news/locale";
import { fetchPartnerCover } from "@/lib/news/partner-images";
import { SOCIAL_PREVIEW_PATH } from "@/lib/oddsfront-site";
import type { Locale } from "@/lib/news/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOCIAL_FONTS: Record<Locale, { filename: string; family: string }> = {
  en: { filename: "inter-social-v1.ttf", family: "Inter" },
  zh: { filename: "noto-sans-sc-social-v1.ttf", family: "Noto Sans SC" },
  ko: { filename: "noto-sans-kr-social-v1.ttf", family: "Noto Sans KR" },
  vi: { filename: "inter-social-v1.ttf", family: "Inter" },
  de: { filename: "inter-social-v1.ttf", family: "Inter" },
  es: { filename: "inter-social-v1.ttf", family: "Inter" },
  "pt-BR": { filename: "inter-social-v1.ttf", family: "Inter" },
  fr: { filename: "inter-social-v1.ttf", family: "Inter" },
  ru: { filename: "inter-social-v1.ttf", family: "Inter" },
  uk: { filename: "inter-social-v1.ttf", family: "Inter" },
  fa: { filename: "almarai-social-v1.ttf", family: "Almarai" },
  he: { filename: "noto-sans-hebrew-social-v1.ttf", family: "Noto Sans Hebrew" },
};

function fontPath(locale: Locale) {
  return path.join(process.cwd(), "public", "fonts", SOCIAL_FONTS[locale].filename);
}

function escapeMarkup(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function textLayer(
  text: string,
  locale: Locale,
  size: number,
  width: number,
  align: "left" | "right" = "left",
) {
  return sharp({
    text: {
      text: `<span foreground="#ffffff">${escapeMarkup(text)}</span>`,
      font: `${SOCIAL_FONTS[locale].family} Bold ${size}`,
      fontfile: fontPath(locale),
      width,
      align,
      wrap: "word-char",
      rgba: true,
      spacing: Math.max(5, Math.round(size * 0.12)),
    },
  }).png().toBuffer({ resolveWithObject: true });
}

async function fittedTitle(text: string, locale: Locale) {
  const initialSize = text.length > 125 ? 43 : text.length > 82 ? 51 : 60;
  for (let size = initialSize; size >= 35; size -= 4) {
    const layer = await textLayer(
      text,
      locale,
      size,
      1030,
      localeDirection(locale) === "rtl" ? "right" : "left",
    );
    if (layer.info.height <= 330 || size === 35) return layer;
  }
  throw new Error("Unable to fit social title");
}

function brandOverlay(fallbackBackground: boolean) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <linearGradient id="fallback" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#07111e"/><stop offset="0.62" stop-color="#101c36"/><stop offset="1" stop-color="#3538aa"/>
      </linearGradient>
      <linearGradient id="side" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#030912" stop-opacity="0.96"/><stop offset="0.58" stop-color="#030912" stop-opacity="0.80"/><stop offset="1" stop-color="#030912" stop-opacity="0.30"/>
      </linearGradient>
      <linearGradient id="bottom" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#030912" stop-opacity="0.95"/><stop offset="0.66" stop-color="#030912" stop-opacity="0.22"/><stop offset="1" stop-color="#030912" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="purple" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#7778ff"/><stop offset="1" stop-color="#5548ff"/>
      </linearGradient>
      <filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="8"/></filter>
    </defs>
    ${fallbackBackground ? '<rect width="1200" height="630" fill="url(#fallback)"/>' : ""}
    <rect width="1200" height="630" fill="url(#side)"/>
    <rect width="1200" height="630" fill="url(#bottom)"/>
    <g transform="translate(66 52) skewX(-25)">
      <rect x="0" y="0" width="13" height="43" rx="2" fill="#665cff" opacity="0.48" filter="url(#glow)"/>
      <rect x="26" y="0" width="13" height="43" rx="2" fill="#665cff" opacity="0.48" filter="url(#glow)"/>
      <rect x="0" y="0" width="13" height="43" rx="2" fill="url(#purple)"/>
      <rect x="26" y="0" width="13" height="43" rx="2" fill="url(#purple)"/>
    </g>
  </svg>`);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; slug: string }> },
) {
  const { locale: segment, slug } = await params;
  const locale = normalizeLocale(segment);
  const article = await getNewsArticle(slug);
  if (!locale || !article || (locale !== "en" && !article.translations[locale])) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const text = articleText(article, locale);
  const source = article.sources.find((candidate) => candidate.kind === "media");
  const cover = source ? await fetchPartnerCover(source.url) : null;
  let coverImage: Buffer | null = null;
  if (cover) {
    try {
      coverImage = await sharp(Buffer.from(cover.body))
        .rotate()
        .resize(1200, 630, { fit: "cover", position: "centre" })
        .png({ compressionLevel: 8 })
        .toBuffer();
    } catch { /* A malformed partner image falls back to branded artwork. */ }
  }

  const cacheControl = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
  const pngResponse = (body: Buffer | ArrayBuffer) => {
    const arrayBuffer = body instanceof ArrayBuffer
      ? body
      : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    return new Response(arrayBuffer, { headers: { "Content-Type": "image/png", "Cache-Control": cacheControl } });
  };

  let renderStage = "text layers";
  try {
    const [wordmark, title] = await Promise.all([
      textLayer("OddsFront", "en", 30, 250),
      fittedTitle(text.title, locale),
    ]);
    renderStage = "background";
    const base = coverImage
      ? sharp(coverImage)
      : sharp({ create: { width: 1200, height: 630, channels: 4, background: "#07121f" } });
    const titleLeft = localeDirection(locale) === "rtl"
      ? 1200 - 58 - title.info.width
      : 58;
    renderStage = "composition";
    const composed = await base.composite([
      { input: brandOverlay(!coverImage), top: 0, left: 0 },
      { input: wordmark.data, top: 56, left: 126 },
      { input: title.data, top: 630 - 58 - title.info.height, left: titleLeft },
    ]).png({ compressionLevel: 8 }).toBuffer();
    return pngResponse(composed);
  } catch (error) {
    console.error("OddsFront social-card render failed", { locale, slug, renderStage, error });
    try {
      const fallback = await readFile(path.join(process.cwd(), "public", SOCIAL_PREVIEW_PATH.replace(/^\/+/, "")));
      return pngResponse(fallback);
    } catch {
      return new Response(null, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
  }
}
