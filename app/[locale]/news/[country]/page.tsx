import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewsOverview } from "@/components/news/news";
import { ArticlePageContent } from "@/components/news/article-page";
import { getNewsArticle, getNewsCatalog } from "@/lib/news/catalog";
import { normalizeLocale } from "@/lib/news/locale";
import { articleMetadata, newsMetadata } from "@/lib/news/metadata";
import { newsOverviewProps } from "@/lib/news/index-page";
import { isNewsCountrySegment } from "@/lib/news/routing";

type Props = { params: Promise<{ locale: string; country: string }> };
export const revalidate = 3600;
// Articles and country listings render on first request and are then served
// from the ISR cache until the revalidation window ends.
export function generateStaticParams(): { country: string }[] { return []; }
// The existing dynamic segment retains legacy country listings; article slugs
// now occupy the same depth, with the language only in the leading segment.
// English country listings (/en/news/<cc>) and "world" redirect in
// next.config.ts before reaching this page.
function isLocalizedCountryListing(locale: string, slug: string): boolean {
  return isNewsCountrySegment(slug) && slug !== "world" && locale !== "en";
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: segment, country: slug } = await params;
  const locale = normalizeLocale(segment);
  if (!locale) return {};
  if (isNewsCountrySegment(slug)) return isLocalizedCountryListing(locale, slug) ? newsMetadata(locale, slug) : {};
  const article = await getNewsArticle(slug);
  return article && (locale === "en" || article.translations[locale]) ? articleMetadata(article, locale) : {};
}
export default async function LocalizedNewsRoute({ params }: Props) {
  const { locale: segment, country: slug } = await params;
  const locale = normalizeLocale(segment);
  if (!locale) notFound();
  if (!isNewsCountrySegment(slug)) return <ArticlePageContent slug={slug} locale={locale}/>;
  if (!isLocalizedCountryListing(locale, slug)) notFound();
  const catalog = await getNewsCatalog();
  return <NewsOverview {...newsOverviewProps(catalog, { country: slug.toUpperCase() })} activeCountry={slug.toUpperCase()}/>;
}
