import { getNewsCatalog } from "@/lib/news/catalog";
import { newsIndexPage } from "@/lib/news/index-page";
import { isNewsCategory } from "@/lib/news/categories";
import { normalizeLocale } from "@/lib/news/locale";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const category = params.get("category");
    const catalog = await getNewsCatalog();
    return Response.json(newsIndexPage(catalog, {
      offset: Number(params.get("offset") ?? 0), country: params.get("country") ?? undefined,
      category: category && isNewsCategory(category) ? category : undefined,
      query: params.get("q") ?? undefined, locale: normalizeLocale(params.get("lang")) ?? "en",
    }), { headers: {
      "Cache-Control": "no-store",
      // Browsers refresh listings once a minute; the shared edge copy of each
      // query lasts two minutes, so an edition is at most that old on screen.
      "CDN-Cache-Control": "public, max-age=120, stale-while-revalidate=600, stale-if-error=900",
      "Vercel-CDN-Cache-Control": "public, max-age=120, stale-while-revalidate=600, stale-if-error=900",
    } });
  } catch {
    return Response.json({ error: "news_temporarily_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
  }
}
