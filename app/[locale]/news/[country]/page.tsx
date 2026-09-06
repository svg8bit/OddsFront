import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewsOverview } from "@/components/news/news";
import { getNewsCatalog } from "@/lib/news/catalog";
import { normalizeLocale } from "@/lib/news/locale";
import { newsMetadata } from "@/lib/news/metadata";
import { newsIndex } from "@/lib/news/publication";

type Props = { params: Promise<{ locale: string; country: string }> };
export const revalidate = 60;
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: segment, country } = await params;
  const locale = normalizeLocale(segment);
  return locale && locale !== "en" ? newsMetadata(locale, country) : {};
}
export default async function LocalizedCountryNews({ params }: Props) {
  const { locale: segment, country } = await params;
  const locale = normalizeLocale(segment);
  if (!locale || locale === "en" || (country !== "world" && !/^[a-z]{2}$/.test(country))) notFound();
  const catalog = await getNewsCatalog();
  return <NewsOverview initialArticles={newsIndex(catalog).articles} initialUpdatedAt={catalog.updatedAt} activeCountry={country === "world" ? "ALL" : country.toUpperCase()}/>;
}
