import type { Metadata } from "next";
import { NewsOverview } from "@/components/news/news";
import { getNewsCatalog } from "@/lib/news/catalog";
import { newsOverviewProps } from "@/lib/news/index-page";
export const revalidate=60;
export const metadata:Metadata={title:"News archive | OddsFront",alternates:{canonical:"/news/archive"}};
export default async function NewsArchive(){const catalog=await getNewsCatalog();return <NewsOverview {...newsOverviewProps(catalog)} activeCountry="ALL" archive/>;}
