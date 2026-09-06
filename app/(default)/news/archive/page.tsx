import type { Metadata } from "next";
import { NewsOverview } from "@/components/news/news";
import { getNewsCatalog } from "@/lib/news/catalog";
import { newsIndex } from "@/lib/news/publication";
export const revalidate=60;
export const metadata:Metadata={title:"News archive | OddsFront",alternates:{canonical:"/news/archive"}};
export default async function NewsArchive(){const catalog=await getNewsCatalog();return <NewsOverview {...{initialArticles:newsIndex(catalog).articles,initialUpdatedAt:catalog.updatedAt}} activeCountry="ALL" archive/>;}
