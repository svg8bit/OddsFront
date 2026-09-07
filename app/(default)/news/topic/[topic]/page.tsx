import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewsOverview } from "@/components/news/news";
import { getNewsCatalog } from "@/lib/news/catalog";
import { newsIndex } from "@/lib/news/publication";
import { isNewsCategory } from "@/lib/news/categories";
import { topicMetadata, topicStructuredData } from "@/lib/news/metadata";

type Props = { params: Promise<{ topic:string }> };
export const revalidate = 60;
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const {topic}=await params;
  return isNewsCategory(topic)?topicMetadata(topic,"en"):{};
}
export default async function TopicPage({params}:Props) {
  const {topic}=await params;
  if(!isNewsCategory(topic))notFound();
  const catalog=await getNewsCatalog();
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(topicStructuredData(topic,"en",catalog.articles)).replace(/</g,"\\u003c")}}/><NewsOverview initialArticles={newsIndex(catalog).articles} initialUpdatedAt={catalog.updatedAt} activeCategory={topic}/></>;
}
