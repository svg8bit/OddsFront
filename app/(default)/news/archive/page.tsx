import { NewsOverview } from "@/components/news/news";
import { getNewsCatalog } from "@/lib/news/catalog";
import { newsOverviewProps } from "@/lib/news/index-page";
import { newsUtilityMetadata } from "@/lib/news/metadata";
// Later pages live at /news/archive/<page>; `?page=` requests are redirected
// there by proxy.ts so this page needs no request data.
export const revalidate=1800;
export const metadata = newsUtilityMetadata("archive", 1);

export default async function NewsArchive() {
  const catalog = await getNewsCatalog();
  return <NewsOverview {...newsOverviewProps(catalog, { offset: 0 })} activeCountry="ALL" archive initialOffset={0} archivePage={1}/>;
}
