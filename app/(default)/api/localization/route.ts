import { getNewsCatalog } from "@/lib/news/catalog";
import { normalizeLocale } from "@/lib/news/locale";
// Market-title dictionaries change only when a translation export completes.
export async function GET(request:Request){const locale=normalizeLocale(new URL(request.url).searchParams.get("lang"));if(!locale)return Response.json({error:"Unsupported language"},{status:400});const catalog=await getNewsCatalog();return Response.json({locale,updatedAt:catalog.updatedAt,messages:catalog.marketTranslations[locale]??{}},{headers:{"Cache-Control":"public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"}});}
