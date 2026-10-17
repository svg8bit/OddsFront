import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewsOverview } from "@/components/news/news";
import { getNewsCatalog } from "@/lib/news/catalog";
import { normalizeLocale } from "@/lib/news/locale";
import { newsMetadata } from "@/lib/news/metadata";
import { newsOverviewProps } from "@/lib/news/index-page";

type Props = { params: Promise<{ locale: string }> };
export const revalidate = 1800;
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = normalizeLocale((await params).locale);
  return locale && locale !== "en" ? newsMetadata(locale) : {};
}
export default async function LocalizedNewsPage({ params }: Props) {
  const locale = normalizeLocale((await params).locale);
  // /en/news redirects to /news in next.config.ts before reaching this page.
  if (!locale || locale === "en") notFound();
  const catalog = await getNewsCatalog();
  return <NewsOverview {...newsOverviewProps(catalog)}/>;
}
