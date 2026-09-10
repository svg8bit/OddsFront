import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { NewsOverview } from "@/components/news/news";
import { newsOverviewProps } from "@/lib/news/index-page";
import { getNewsArticle, getNewsCatalog } from "@/lib/news/catalog";
import { normalizeLocale } from "@/lib/news/locale";
import { articleMetadata, newsMetadata } from "@/lib/news/metadata";
import { isNewsCountrySegment, newsArticlePath, newsCountryPath } from "@/lib/news/routing";
export const revalidate = 60;
type Props = { params: Promise<{ country: string }>; searchParams: Promise<{ lang?: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country } = await params;
  if (isNewsCountrySegment(country)) return newsMetadata("en", country);
  const article = await getNewsArticle(country);
  return article ? articleMetadata(article, "en") : {};
}
export default async function DefaultNewsRoute({ params, searchParams }: Props) {
  const { country } = await params;
  const locale = normalizeLocale((await searchParams).lang);
  if (!isNewsCountrySegment(country)) {
    const article = await getNewsArticle(country);
    if (!article || (locale && locale !== "en" && !article.translations[locale])) notFound();
    permanentRedirect(newsArticlePath(article, locale ?? "en"));
  }
  if (locale && locale !== "en") permanentRedirect(newsCountryPath(country, locale));
  const catalog = await getNewsCatalog();
  return <NewsOverview {...newsOverviewProps(catalog, { country: country === "world" ? "ALL" : country.toUpperCase() })} activeCountry={country === "world" ? "ALL" : country.toUpperCase()}/>;
}
