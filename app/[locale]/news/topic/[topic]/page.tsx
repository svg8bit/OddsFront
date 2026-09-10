import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewsOverview } from "@/components/news/news";
import { getNewsCatalog } from "@/lib/news/catalog";
import { newsOverviewProps } from "@/lib/news/index-page";
import { isNewsCategory } from "@/lib/news/categories";
import { normalizeLocale } from "@/lib/news/locale";
import { topicMetadata, topicStructuredData } from "@/lib/news/metadata";

type Props = { params:Promise<{ locale:string; topic:string }> };
export const revalidate=60;
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const {locale:segment,topic}=await params;const locale=normalizeLocale(segment);
  return locale&&locale!=="en"&&isNewsCategory(topic)?topicMetadata(topic,locale):{};
}
export default async function TopicPage({params}:Props) {
  const {locale:segment,topic}=await params;const locale=normalizeLocale(segment);
  if(!locale||locale==="en"||!isNewsCategory(topic))notFound();
  const catalog=await getNewsCatalog();
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(topicStructuredData(topic,locale,catalog.articles)).replace(/</g,"\\u003c")}}/><NewsOverview {...newsOverviewProps(catalog, { category: topic })} activeCategory={topic}/></>;
}
