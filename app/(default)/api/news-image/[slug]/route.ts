import { getNewsArticle, getOwnNewsCover } from "@/lib/news/catalog";
import { fetchPartnerCover } from "@/lib/news/partner-images";

export const dynamic = "force-dynamic";
export const maxDuration = 12;

function unavailable(status: number) {
  // A missing cover (or an unreachable feed) is cached briefly at the edge so
  // repeated listing views do not invoke this route for the same slug.
  return new Response(null, {
    status,
    headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const article = await getNewsArticle(slug);
  if (article?.cover?.kind === "own") {
    const own = await getOwnNewsCover(slug);
    if (!own) return unavailable(404);
    return new Response(own, {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        "Content-Length": String(own.byteLength),
        "Content-Type": "image/jpeg",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  // Desk articles without their own cover never borrow a publisher photo.
  if (article?.cover?.kind === "none") return unavailable(404);
  const source = article?.sources.find(candidate => candidate.kind === "media");
  if (!source) return unavailable(404);
  const cover = await fetchPartnerCover(article?.cover?.sourceUrl || source.url, article?.cover?.imageUrl);
  if (!cover) return unavailable(404);
  return new Response(cover.body, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      "Content-Length": String(cover.body.byteLength),
      "Content-Type": cover.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
