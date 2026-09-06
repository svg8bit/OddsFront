import type { Metadata } from "next";
import { NewsOverview } from "@/components/news/news";
import { newsIndex } from "@/lib/news/publication";
import { getNewsCatalog } from "@/lib/news/catalog";
export const revalidate = 60;
export const metadata: Metadata = { title: "World News & Geopolitics | OddsFront", description: "Verified world news, country coverage and related live prediction markets.", alternates: { canonical: "/news", types: { "application/rss+xml": "/news/rss.xml" } }, openGraph: { title: "OddsFront News", description: "World events. Clear context. Live probabilities.", url: "/news", type: "website" } };
export default async function NewsPage() { const catalog=await getNewsCatalog(); return <NewsOverview initialArticles={newsIndex(catalog).articles} initialUpdatedAt={catalog.updatedAt}/>; }
