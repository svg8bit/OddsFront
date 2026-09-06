import { Buffer } from "node:buffer";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { getNewsArticle } from "@/lib/news/catalog";
import { articleText, normalizeLocale } from "@/lib/news/locale";
import { fetchPartnerCover } from "@/lib/news/partner-images";
import { SOCIAL_PREVIEW_PATH } from "@/lib/oddsfront-site";

export const runtime = "nodejs";
export const revalidate = 3600;

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
      coverImage = await sharp(Buffer.from(cover.body)).rotate().resize(1200, 630, { fit: "cover", position: "centre" }).png({ compressionLevel: 8 }).toBuffer();
    } catch { /* A malformed partner image falls back to branded artwork. */ }
  }
  const titleSize = text.title.length > 125 ? 43 : text.title.length > 82 ? 51 : 60;
  const renderCard = (fallbackBackground: boolean) => new ImageResponse(
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", overflow: "hidden", color: "white", backgroundColor: fallbackBackground ? "#07121f" : "transparent", backgroundImage: fallbackBackground ? "radial-gradient(circle at 75% 25%, #3538aa 0, transparent 36%), linear-gradient(135deg, #101c36 0%, #07111e 70%)" : "linear-gradient(transparent, transparent)" }}>
      <div style={{ position: "relative", width: "100%", height: "100%", boxSizing: "border-box", padding: "48px 58px", display: "flex", flexDirection: "column", backgroundImage: "linear-gradient(90deg, rgba(3,9,18,.95) 0%, rgba(3,9,18,.80) 58%, rgba(3,9,18,.30) 100%), linear-gradient(0deg, rgba(3,9,18,.94) 0%, rgba(3,9,18,.22) 66%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 29, fontWeight: 700 }}>
          <div style={{ width: 58, height: 48, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
            <span style={{ display: "flex", width: 12, height: 42, transform: "skew(-25deg)", background: "linear-gradient(145deg,#7778ff,#5548ff)", boxShadow: "0 8px 24px rgba(92,91,255,.42)" }}/>
            <span style={{ display: "flex", width: 12, height: 42, transform: "skew(-25deg)", background: "linear-gradient(145deg,#7778ff,#5548ff)", boxShadow: "0 8px 24px rgba(92,91,255,.42)" }}/>
          </div>
          <span>OddsFront</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 1030, marginTop: "auto", marginBottom: 48 }}>
          <div style={{ display: "flex", fontSize: titleSize, fontWeight: 720, lineHeight: 1.08, letterSpacing: -1.7, textShadow: "0 2px 24px rgba(0,0,0,.72)" }}>{text.title}</div>
        </div>
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
  const cacheControl = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
  const pngResponse = (body: ArrayBuffer) => new Response(body, { headers: { "Content-Type": "image/png", "Cache-Control": cacheControl } });
  if (coverImage) {
    try {
      const overlay = Buffer.from(await renderCard(false).arrayBuffer());
      const composed = await sharp(coverImage).composite([{ input: overlay }]).png({ compressionLevel: 8 }).toBuffer();
      return pngResponse(composed.buffer.slice(composed.byteOffset, composed.byteOffset + composed.byteLength) as ArrayBuffer);
    } catch { /* Preserve a valid social image if composition fails. */ }
  }
  try {
    return pngResponse(await renderCard(true).arrayBuffer());
  } catch {
    const fallback = await fetch(new URL(SOCIAL_PREVIEW_PATH, _request.url), { cache: "force-cache" });
    return fallback.ok
      ? pngResponse(await fallback.arrayBuffer())
      : new Response(null, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
