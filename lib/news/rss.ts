import { articleText } from "./locale.ts";
import { articleCategory, categoryLabel } from "./categories.ts";
import { newsArticlePath, newsPath } from "./routing.ts";
import type { Locale, NewsCatalog } from "./types.ts";

const origin="https://oddsfront.com";
const xml=(value:string)=>value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
export function newsRss(catalog:NewsCatalog,locale:Locale) {
  const items=catalog.articles.filter(article=>locale==="en"||article.translations[locale]).slice(0,50).map(article=>{
    const text=articleText(article,locale);const href=origin+newsArticlePath(article,locale);
    const cover=`${origin}/social/news/${locale.toLowerCase()}/${article.slug}?v=${encodeURIComponent(article.updatedAt)}`;
    return `<item><title>${xml(text.title)}</title><link>${xml(href)}</link><guid isPermaLink="true">${xml(href)}</guid><description>${xml(text.description)}</description><category>${xml(categoryLabel(articleCategory(article),locale))}</category><pubDate>${new Date(article.publishedAt).toUTCString()}</pubDate><media:content url="${xml(cover)}" type="image/png" medium="image" width="1200" height="630"/></item>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>OddsFront News — ${xml(locale)}</title><link>${origin}${newsPath(locale)}</link><description>World news and geopolitical context</description><language>${xml(locale)}</language><lastBuildDate>${new Date(catalog.updatedAt).toUTCString()}</lastBuildDate><ttl>60</ttl><atom:link href="${origin}${newsPath(locale,"/rss.xml")}" rel="self" type="application/rss+xml"/>${items}</channel></rss>`;
}

export const RSS_HEADERS={"Content-Type":"application/rss+xml; charset=utf-8","Cache-Control":"public, max-age=60, s-maxage=300"};
