import { getNewsCatalog } from "@/lib/news/catalog";
import { newsSitemap, newsSitemapLocale } from "@/lib/news/news-sitemap";

export const revalidate = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ part: string }> },
) {
  const { part } = await params;
  const match = part.match(/^([a-z]{2}(?:-[a-z]{2})?)-(\d+)\.xml$/i);
  const locale = match ? newsSitemapLocale(match[1]) : null;
  const body = locale && match ? newsSitemap(await getNewsCatalog(), locale, Number(match[2])) : null;
  return body === null
    ? new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } })
    : new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600" } });
}
