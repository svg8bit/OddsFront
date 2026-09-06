import type { MetadataRoute } from "next";
import { getNewsCatalog } from "@/lib/news/catalog";
export const revalidate=300;
export default async function sitemap():Promise<MetadataRoute.Sitemap>{const catalog=await getNewsCatalog();const origin="https://oddsfront.com";return [{url:origin,lastModified:new Date(catalog.updatedAt)},{url:`${origin}/news`,lastModified:new Date(catalog.updatedAt)},...catalog.articles.map(article=>({url:`${origin}/news/${(article.countries[0]||"world").toLowerCase()}/${article.slug}`,lastModified:new Date(article.updatedAt)}))];}
