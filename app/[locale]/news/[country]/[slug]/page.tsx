import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { NewsArticleView } from "@/components/news/news";
import { getNewsArticle } from "@/lib/news/catalog";
import { normalizeLocale } from "@/lib/news/locale";
import { articleMetadata, articleStructuredData } from "@/lib/news/metadata";
import { newsArticlePath } from "@/lib/news/routing";
import { getConflictPreviewFeed } from "@/lib/polymarket-conflict-preview";

type Props = { params: Promise<{ locale: string; country: string; slug: string }> };
export const revalidate = 60;
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: segment, slug } = await params;
  const [locale, article] = [normalizeLocale(segment), await getNewsArticle(slug)];
  return locale && locale !== "en" && article ? articleMetadata(article, locale) : {};
}
export default async function LocalizedArticlePage({ params }: Props) {
  const { locale: segment, country, slug } = await params;
  const locale = normalizeLocale(segment);
  const [article, feed] = await Promise.all([getNewsArticle(slug), getConflictPreviewFeed()]);
  if (!locale || locale === "en" || !article || !article.translations[locale]) notFound();
  const canonicalCountry = (article.countries[0] || "world").toLowerCase();
  if (country !== canonicalCountry) permanentRedirect(newsArticlePath(article, locale));
  const structured = articleStructuredData(article, locale);
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, "\\u003c") }}/><NewsArticleView article={article} initialFeed={feed}/></>;
}
