import { getNewsCatalog } from "@/lib/news/catalog";
import { articleText } from "@/lib/news/locale";
import { articleLocales, newsArticlePath } from "@/lib/news/routing";

export const revalidate = 300;
const xml = (value: string) => value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");

export async function GET() {
  const catalog = await getNewsCatalog();
  const cutoff = Date.now() - 48 * 60 * 60_000;
  const urls = catalog.articles
    .filter((article) => Date.parse(article.publishedAt) >= cutoff)
    .flatMap((article) => articleLocales(article).map((locale) => {
      const text = articleText(article, locale);
      return `<url><loc>${xml(`https://oddsfront.com${newsArticlePath(article, locale)}`)}</loc><news:news><news:publication><news:name>OddsFront</news:name><news:language>${xml(locale.split("-",1)[0])}</news:language></news:publication><news:publication_date>${xml(article.publishedAt)}</news:publication_date><news:title>${xml(text.title)}</news:title></news:news></url>`;
    }))
    .slice(0, 1000)
    .join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${urls}</urlset>`, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600" },
  });
}
