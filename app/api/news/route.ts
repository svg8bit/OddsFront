import { getNewsCatalog } from "@/lib/news/catalog";
import { newsIndex } from "@/lib/news/publication";
export async function GET(){const catalog=await getNewsCatalog();return Response.json(newsIndex(catalog),{headers:{"Cache-Control":"public, max-age=0, s-maxage=60, stale-while-revalidate=60"}});}
