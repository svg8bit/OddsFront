import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewsOverview } from "@/components/news/news";
import { getNewsCatalog } from "@/lib/news/catalog";
import { NEWS_INDEX_PAGE_SIZE, newsOverviewProps } from "@/lib/news/index-page";
import { newsUtilityMetadata } from "@/lib/news/metadata";
export const revalidate=60;

type ArchivePageProps = { searchParams: Promise<{ page?: string | string[] }> };

function pageNumber(value: string | string[] | undefined): number | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === undefined) return 1;
  if (!/^[1-9]\d*$/.test(candidate)) return null;
  const page = Number(candidate);
  return Number.isSafeInteger(page) && Number.isSafeInteger(page * NEWS_INDEX_PAGE_SIZE) ? page : null;
}

export async function generateMetadata({ searchParams }: ArchivePageProps): Promise<Metadata> {
  const page = pageNumber((await searchParams).page) ?? 1;
  return newsUtilityMetadata("archive", page);
}

export default async function NewsArchive({ searchParams }: ArchivePageProps) {
  const page = pageNumber((await searchParams).page);
  if (page === null) notFound();
  const offset = (page - 1) * NEWS_INDEX_PAGE_SIZE;
  const catalog = await getNewsCatalog();
  const props = newsOverviewProps(catalog, { offset });
  if (page > 1 && props.initialArticles.length === 0) notFound();
  return <NewsOverview {...props} activeCountry="ALL" archive initialOffset={offset} archivePage={page}/>;
}
