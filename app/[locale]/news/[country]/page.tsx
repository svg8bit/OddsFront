import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { NewsOverview } from "@/components/news/news";
import { ArticlePageContent } from "@/components/news/article-page";
import { getNewsArticle, getNewsCatalog } from "@/lib/news/catalog";
import { normalizeLocale } from "@/lib/news/locale";
import { articleMetadata, newsMetadata } from "@/lib/news/metadata";
import { newsOverviewProps } from "@/lib/news/index-page";
import { isNewsCountrySegment, newsCountryPath } from "@/lib/news/routing";

type Props = { params: Promise<{ locale: string; country: string }> };
export const revalidate = 60;
// The existing dynamic segment retains legacy country listings; article slugs
// now occupy the same depth, with the language only in the leading segment.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: segment, country: slug } = await params;
  const locale = normalizeLocale(segment);
  if (!locale) return {};
  if (isNewsCountrySegment(slug)) return newsMetadata(locale, slug);
  const article = await getNewsArticle(slug);
  return article && (locale === "en" || article.translations[locale]) ? articleMetadata(article, locale) : {};
}
export default async function LocalizedNewsRoute({ params }: Props) {
  const { locale: segment, country: slug } = await params;
  const locale = normalizeLocale(segment);
  if (!locale) notFound();
  if (!isNewsCountrySegment(slug)) return <ArticlePageContent slug={slug} locale={locale}/>;
  if (locale === "en") permanentRedirect(newsCountryPath(slug, "en"));
  const catalog = await getNewsCatalog();
  return <NewsOverview {...newsOverviewProps(catalog, { country: slug === "world" ? "ALL" : slug.toUpperCase() })} activeCountry={slug === "world" ? "ALL" : slug.toUpperCase()}/>;
}
