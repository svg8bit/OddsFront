import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewsOverview } from "@/components/news/news";
import { getNewsCatalog } from "@/lib/news/catalog";
import { NEWS_INDEX_PAGE_SIZE, newsOverviewProps } from "@/lib/news/index-page";
import { newsUtilityMetadata } from "@/lib/news/metadata";
export const revalidate = 3600;
export function generateStaticParams(): { page: string }[] { return []; }

type ArchivePageProps = { params: Promise<{ page: string }> };

// Page 1 is /news/archive itself; /news/archive/1 redirects in next.config.ts.
function pageNumber(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const page = Number(value);
  return page > 1 && Number.isSafeInteger(page) && Number.isSafeInteger(page * NEWS_INDEX_PAGE_SIZE) ? page : null;
}

export async function generateMetadata({ params }: ArchivePageProps): Promise<Metadata> {
  const page = pageNumber((await params).page);
  return page ? newsUtilityMetadata("archive", page) : {};
}

export default async function NewsArchivePage({ params }: ArchivePageProps) {
  const page = pageNumber((await params).page);
  if (page === null) notFound();
  const offset = (page - 1) * NEWS_INDEX_PAGE_SIZE;
  const catalog = await getNewsCatalog();
  const props = newsOverviewProps(catalog, { offset });
  if (props.initialArticles.length === 0) notFound();
  return <NewsOverview {...props} activeCountry="ALL" archive initialOffset={offset} archivePage={page}/>;
}
