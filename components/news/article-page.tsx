import { notFound } from "next/navigation";
import { NewsArticleView } from "./news";
import { getNewsArticle } from "@/lib/news/catalog";
import { articleStructuredData } from "@/lib/news/metadata";
import { getConflictPreviewFeed } from "@/lib/polymarket-conflict-preview";
import type { Locale } from "@/lib/news/types";

export async function ArticlePageContent({ slug, locale }: { slug: string; locale: Locale }) {
  const article = await getNewsArticle(slug);
  if (!article || (locale !== "en" && !article.translations[locale])) notFound();
  const feed = await getConflictPreviewFeed();
  const structured = articleStructuredData(article, locale);
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, "\\u003c") }}/><NewsArticleView article={article} initialFeed={feed}/></>;
}
