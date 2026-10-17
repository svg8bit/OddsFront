import { NewsOverview } from "@/components/news/news";
import { newsOverviewProps } from "@/lib/news/index-page";
import { getNewsCatalog } from "@/lib/news/catalog";
import { newsMetadata } from "@/lib/news/metadata";
// Legacy `?lang=` redirects live in proxy.ts so this page reads no request
// data and stays in the ISR cache between revalidations.
export const revalidate = 1800;
export const metadata = newsMetadata("en");
export default async function NewsPage() {
  const catalog=await getNewsCatalog();
  return <NewsOverview {...newsOverviewProps(catalog)}/>;
}
