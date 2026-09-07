import { getNewsCatalog } from "@/lib/news/catalog";
import { normalizeLocale } from "@/lib/news/locale";
import { newsRss, RSS_HEADERS } from "@/lib/news/rss";
export async function GET(_request:Request,{params}:{params:Promise<{locale:string}>}) {
  const locale=normalizeLocale((await params).locale);
  if(!locale||locale==="en")return new Response("Not found",{status:404});
  return new Response(newsRss(await getNewsCatalog(),locale),{headers:RSS_HEADERS});
}
