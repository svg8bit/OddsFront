import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { getNewsArticle } from "@/lib/news/catalog";
import { articleText, localeDirection, normalizeLocale } from "@/lib/news/locale";
import { fetchPartnerCover } from "@/lib/news/partner-images";
import { SOCIAL_PREVIEW_PATH } from "@/lib/oddsfront-site";
import type { Locale } from "@/lib/news/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOCIAL_FONT_FILES: Record<Locale, string> = {
  en: "inter-social-v1.ttf",
  zh: "noto-sans-sc-social-v1.ttf",
  ko: "noto-sans-kr-social-v1.ttf",
  vi: "inter-social-v1.ttf",
  de: "inter-social-v1.ttf",
  es: "inter-social-v1.ttf",
  "pt-BR": "inter-social-v1.ttf",
  fr: "inter-social-v1.ttf",
  ru: "inter-social-v1.ttf",
  uk: "inter-social-v1.ttf",
  fa: "almarai-social-v1.ttf",
  he: "noto-sans-hebrew-social-v1.ttf",
};
const fontCache = new Map<string, Promise<ArrayBuffer | null>>();

function toArrayBuffer(value: Buffer): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function loadSocialFont(locale: Locale) {
  const filename = SOCIAL_FONT_FILES[locale];
  let pending = fontCache.get(filename);
  if (!pending) {
    pending = readFile(path.join(process.cwd(), "public", "fonts", filename))
      .then((value) => {
        const data = toArrayBuffer(value);
        return data.byteLength > 1_000 && new DataView(data).getUint32(0) === 0x00010000 ? data : null;
      })
      .catch(() => null);
    fontCache.set(filename, pending);
    void pending.then((data) => { if (!data) fontCache.delete(filename); });
  }
  return pending;
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
  const direction = localeDirection(locale);
  const font = await loadSocialFont(locale);
  const source = article.sources.find((candidate) => candidate.kind === "media");
  const cover = source ? await fetchPartnerCover(source.url) : null;
  let coverImage: Buffer | null = null;
  if (cover) {
    try {
      coverImage = await sharp(Buffer.from(cover.body)).rotate().resize(1200, 630, { fit: "cover", position: "centre" }).png({ compressionLevel: 8 }).toBuffer();
    } catch { /* A malformed partner image falls back to branded artwork. */ }
  }
  const titleSize = text.title.length > 125 ? 43 : text.title.length > 82 ? 51 : 60;
  const renderCard = (fallbackBackground: boolean) => new ImageResponse(
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", overflow: "hidden", color: "white", fontFamily: font ? "OddsFront Social" : "sans-serif", backgroundColor: fallbackBackground ? "#07121f" : "transparent", backgroundImage: fallbackBackground ? "radial-gradient(circle at 75% 25%, #3538aa 0, transparent 36%), linear-gradient(135deg, #101c36 0%, #07111e 70%)" : "linear-gradient(transparent, transparent)" }}>
      <div style={{ position: "relative", width: "100%", height: "100%", boxSizing: "border-box", padding: "48px 58px", display: "flex", flexDirection: "column", backgroundImage: "linear-gradient(90deg, rgba(3,9,18,.95) 0%, rgba(3,9,18,.80) 58%, rgba(3,9,18,.30) 100%), linear-gradient(0deg, rgba(3,9,18,.94) 0%, rgba(3,9,18,.22) 66%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 29, fontWeight: 700 }}>
          <div style={{ width: 58, height: 48, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
            <span style={{ display: "flex", width: 12, height: 42, transform: "skew(-25deg)", background: "linear-gradient(145deg,#7778ff,#5548ff)", boxShadow: "0 8px 24px rgba(92,91,255,.42)" }}/>
            <span style={{ display: "flex", width: 12, height: 42, transform: "skew(-25deg)", background: "linear-gradient(145deg,#7778ff,#5548ff)", boxShadow: "0 8px 24px rgba(92,91,255,.42)" }}/>
          </div>
          <span>OddsFront</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: 1030, alignSelf: direction === "rtl" ? "flex-end" : "flex-start", marginTop: "auto", marginBottom: 48 }}>
          <div dir={direction} style={{ display: "flex", direction, textAlign: direction === "rtl" ? "right" : "left", fontSize: titleSize, fontWeight: 700, lineHeight: 1.08, letterSpacing: direction === "rtl" ? 0 : -1.7, textShadow: "0 2px 24px rgba(0,0,0,.72)" }}>{text.title}</div>
        </div>
      </div>
    </div>,
    { width: 1200, height: 630, fonts: font ? [{ name: "OddsFront Social", data: font.slice(0), weight: 700 }] : undefined },
  );
  const cacheControl = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
  const pngResponse = (body: ArrayBuffer) => new Response(body, { headers: { "Content-Type": "image/png", "Cache-Control": cacheControl } });
  let overlay: Buffer | null = null;
  try {
    overlay = Buffer.from(await renderCard(!coverImage).arrayBuffer());
  } catch { /* Continue to the static brand fallback only if text rendering fails. */ }
  if (overlay) {
    if (coverImage) {
      try {
        const composed = await sharp(coverImage).composite([{ input: overlay }]).png({ compressionLevel: 8 }).toBuffer();
        return pngResponse(composed.buffer.slice(composed.byteOffset, composed.byteOffset + composed.byteLength) as ArrayBuffer);
      } catch { /* Keep the localized title layer if partner-image composition fails. */ }
    }
    return pngResponse(overlay.buffer.slice(overlay.byteOffset, overlay.byteOffset + overlay.byteLength) as ArrayBuffer);
  }
  try {
    const fallback = await readFile(path.join(process.cwd(), "public", SOCIAL_PREVIEW_PATH.replace(/^\/+/, "")));
    return pngResponse(toArrayBuffer(fallback));
  } catch {
    return new Response(null, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
