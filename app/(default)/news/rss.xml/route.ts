import { getNewsCatalog } from "@/lib/news/catalog";
import { newsRss, RSS_HEADERS } from "@/lib/news/rss";
export async function GET(){return new Response(newsRss(await getNewsCatalog(),"en"),{headers:RSS_HEADERS});}
