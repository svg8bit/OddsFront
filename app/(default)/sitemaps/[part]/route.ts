import { getNewsCatalog } from "@/lib/news/catalog";
import { articleSitemap, coreSitemap } from "@/lib/news/sitemap";

export const revalidate = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ part: string }> },
) {
  const { part } = await params;
  const catalog = await getNewsCatalog();
  const articlePage = part.match(/^articles-(\d+)\.xml$/)?.[1];
  const body = part === "core.xml"
    ? coreSitemap(catalog)
    : articlePage
      ? articleSitemap(catalog, Number(articlePage))
      : null;
  return body === null
    ? new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } })
    : new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600" } });
}
