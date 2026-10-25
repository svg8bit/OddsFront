import { normalizeLocale } from "@/lib/news/locale";
import { marketTranslations } from "@/lib/telegram-app/translations";
// Russian map wording comes from the reviewed Sonnet dictionary that the VPS translation job keeps
// (scripts/news/market-translations.ts); strings it has not translated yet stay English.
export async function GET(request:Request){const locale=normalizeLocale(new URL(request.url).searchParams.get("lang"));if(!locale)return Response.json({error:"Unsupported language"},{status:400});const messages=locale==="ru"?await marketTranslations():{};return Response.json({locale,updatedAt:new Date().toISOString(),messages},{headers:{"Cache-Control":"public, max-age=300, s-maxage=1800, stale-while-revalidate=86400"}});}
