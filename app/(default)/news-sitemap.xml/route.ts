import { getNewsCatalog } from "@/lib/news/catalog";
import { newsSitemapIndex } from "@/lib/news/news-sitemap";

// Google News reads the last 48 hours; editions arrive every two hours.
export const revalidate = 900;
export async function GET() {
  const catalog = await getNewsCatalog();
  return new Response(newsSitemapIndex(catalog), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=60, s-maxage=900, stale-while-revalidate=3600" },
  });
}
