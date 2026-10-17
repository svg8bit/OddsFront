import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewsOverview } from "@/components/news/news";
import { newsOverviewProps } from "@/lib/news/index-page";
import { getNewsCatalog } from "@/lib/news/catalog";
import { newsMetadata } from "@/lib/news/metadata";
import { isNewsCountrySegment } from "@/lib/news/routing";
export const revalidate = 3600;
// Country listings render on first request and are then served from the ISR
// cache. Legacy slugs, "world" and `?lang=` never reach this page: they are
// redirected in next.config.ts and proxy.ts.
export function generateStaticParams(): { country: string }[] { return []; }
type Props = { params: Promise<{ country: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country } = await params;
  return isNewsCountrySegment(country) && country !== "world" ? newsMetadata("en", country) : {};
}
export default async function DefaultNewsRoute({ params }: Props) {
  const { country } = await params;
  if (!isNewsCountrySegment(country) || country === "world") notFound();
  const catalog = await getNewsCatalog();
  return <NewsOverview {...newsOverviewProps(catalog, { country: country.toUpperCase() })} activeCountry={country.toUpperCase()}/>;
}
