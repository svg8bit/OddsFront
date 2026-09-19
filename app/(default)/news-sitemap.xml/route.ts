import { getNewsCatalog } from "@/lib/news/catalog";
import { newsSitemapIndex } from "@/lib/news/news-sitemap";

export const revalidate = 300;
export async function GET() {
  const catalog = await getNewsCatalog();
  return new Response(newsSitemapIndex(catalog), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600" },
  });
}
