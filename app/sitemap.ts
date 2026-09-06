import type { MetadataRoute } from "next";
import { getNewsCatalog } from "@/lib/news/catalog";
import { articleLocales, languageAlternates, newsArticlePath, newsCountryPath, newsPath } from "@/lib/news/routing";
import { LOCALES, type Locale } from "@/lib/news/types";
export const revalidate=300;
export default async function sitemap():Promise<MetadataRoute.Sitemap>{
  const catalog=await getNewsCatalog();
  const origin="https://oddsfront.com";
  const absoluteAlternates=(englishPath:string,locales:readonly Locale[]=LOCALES)=>Object.fromEntries(
    Object.entries(languageAlternates(englishPath,locales)).map(([language,path])=>[language,`${origin}${path}`]),
  );
  const countries=["world",...new Set(catalog.articles.flatMap(article=>article.countries.map(code=>code.toLowerCase())))];
  const newsPages:MetadataRoute.Sitemap=LOCALES.flatMap(locale=>[
    {url:`${origin}${newsPath(locale)}`,lastModified:new Date(catalog.updatedAt),changeFrequency:"hourly" as const,priority:.9,alternates:{languages:absoluteAlternates("/news")}},
    ...countries.map(country=>({url:`${origin}${newsCountryPath(country,locale)}`,lastModified:new Date(catalog.updatedAt),changeFrequency:"hourly" as const,priority:.8,alternates:{languages:absoluteAlternates(`/news/${country}`)}})),
  ]);
  const articles:MetadataRoute.Sitemap=catalog.articles.flatMap(article=>{
    const locales=articleLocales(article);
    const englishPath=newsArticlePath(article,"en");
    const alternates=absoluteAlternates(englishPath,locales);
    return locales.map(locale=>({
      url:`${origin}${newsArticlePath(article,locale)}`,
      lastModified:new Date(article.updatedAt),
      changeFrequency:"daily" as const,
      priority:.8,
      alternates:{languages:alternates},
      images:[`${origin}/social/news/${locale.toLowerCase()}/${article.slug}?v=${encodeURIComponent(article.updatedAt)}`],
    }));
  });
  return [{url:origin,lastModified:new Date(catalog.updatedAt),changeFrequency:"hourly",priority:1},{url:`${origin}/global-conflict-map`,lastModified:new Date(catalog.updatedAt),changeFrequency:"hourly",priority:1},...newsPages,...articles];
}
