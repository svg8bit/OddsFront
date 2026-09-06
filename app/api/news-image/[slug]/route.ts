import { getNewsArticle } from "@/lib/news/catalog";
import { fetchPartnerCover } from "@/lib/news/partner-images";

export const dynamic = "force-dynamic";
export const maxDuration = 12;

function unavailable(status: number) {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const article = await getNewsArticle(slug);
  const source = article?.sources.find(candidate => candidate.kind === "media");
  if (!source) return unavailable(404);
  const cover = await fetchPartnerCover(source.url);
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
