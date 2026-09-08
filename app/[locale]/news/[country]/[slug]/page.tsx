import { notFound, permanentRedirect } from "next/navigation";
import { getNewsArticle } from "@/lib/news/catalog";
import { normalizeLocale } from "@/lib/news/locale";
import { newsArticlePath } from "@/lib/news/routing";
export const revalidate = 60;
type Props = { params: Promise<{ locale: string; country: string; slug: string }> };
export default async function LegacyLocalizedArticlePage({ params }: Props) {
  const { locale: segment, slug } = await params;
  const locale = normalizeLocale(segment);
  const article = await getNewsArticle(slug);
  if (!locale || !article || (locale !== "en" && !article.translations[locale])) notFound();
  permanentRedirect(newsArticlePath(article, locale));
}
