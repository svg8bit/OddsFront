import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { NewsOverview } from "@/components/news/news";
import { getNewsCatalog } from "@/lib/news/catalog";
import { normalizeLocale } from "@/lib/news/locale";
import { newsMetadata } from "@/lib/news/metadata";
import { newsIndex } from "@/lib/news/publication";

type Props = { params: Promise<{ locale: string }> };
export const revalidate = 60;
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = normalizeLocale((await params).locale);
  return locale && locale !== "en" ? newsMetadata(locale) : {};
}
export default async function LocalizedNewsPage({ params }: Props) {
  const locale = normalizeLocale((await params).locale);
  if (!locale) notFound();
  if (locale === "en") permanentRedirect("/news");
  const catalog = await getNewsCatalog();
  return <NewsOverview initialArticles={newsIndex(catalog).articles} initialUpdatedAt={catalog.updatedAt}/>;
}
