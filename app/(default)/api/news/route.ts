import { getNewsCatalog } from "@/lib/news/catalog";
import { newsIndex } from "@/lib/news/publication";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
export async function GET() {
  try {
    const catalog = await getNewsCatalog();
    return Response.json(newsIndex(catalog), { headers: {
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "public, max-age=30, stale-while-revalidate=30, stale-if-error=900",
      "Vercel-CDN-Cache-Control": "public, max-age=30, stale-while-revalidate=30, stale-if-error=900",
    } });
  } catch {
    return Response.json({ error: "news_temporarily_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
  }
}
