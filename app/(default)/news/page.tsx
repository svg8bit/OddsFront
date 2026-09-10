import { permanentRedirect } from "next/navigation";
import { NewsOverview } from "@/components/news/news";
import { newsOverviewProps } from "@/lib/news/index-page";
import { getNewsCatalog } from "@/lib/news/catalog";
import { normalizeLocale } from "@/lib/news/locale";
import { newsMetadata } from "@/lib/news/metadata";
import { newsPath } from "@/lib/news/routing";
export const revalidate = 60;
export const metadata = newsMetadata("en");
export default async function NewsPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const locale = normalizeLocale((await searchParams).lang);
  if (locale) permanentRedirect(newsPath(locale));
  const catalog=await getNewsCatalog();
  return <NewsOverview {...newsOverviewProps(catalog)}/>;
}
