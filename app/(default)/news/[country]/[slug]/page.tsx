import { notFound, permanentRedirect } from "next/navigation";
import { getNewsArticle } from "@/lib/news/catalog";
import { normalizeLocale } from "@/lib/news/locale";
import { newsArticlePath } from "@/lib/news/routing";
export const revalidate = 60;
type Props = { params: Promise<{ country: string; slug: string }>; searchParams: Promise<{ lang?: string }> };
export default async function LegacyArticlePage({ params, searchParams }: Props) {
  const article = await getNewsArticle((await params).slug);
  const locale = normalizeLocale((await searchParams).lang) ?? "en";
  if (!article || (locale !== "en" && !article.translations[locale])) notFound();
  permanentRedirect(newsArticlePath(article, locale));
}
