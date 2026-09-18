import type { Metadata } from "next";

import { NewsOverview } from "@/components/news/news";
import { getNewsCatalog } from "@/lib/news/catalog";
import { newsOverviewProps } from "@/lib/news/index-page";
import { buildOddsFrontSocialMetadata } from "@/lib/oddsfront-site";

export const metadata: Metadata = {
  ...buildOddsFrontSocialMetadata("/"),
  alternates: { canonical: "/" },
};
export const revalidate = 60;

export default async function HomePage() {
  const catalog = await getNewsCatalog();
  return <NewsOverview {...newsOverviewProps(catalog)} />;
}
