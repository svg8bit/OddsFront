import { notFound } from "next/navigation";
import { NewsArticleView } from "./news";
import { getNewsArticle } from "@/lib/news/catalog";
import { articleStructuredData } from "@/lib/news/metadata";
import { PREVIEW_MINIMUM_VOLUME } from "@/features/global-conflict-map/preview/fixture";
import type { ConflictPreviewFeed } from "@/features/global-conflict-map/preview/types";
import type { Locale } from "@/lib/news/types";

// Article HTML is cached by ISR for a day, so it must not embed a live
// market snapshot: that snapshot is refreshed every minute through
// `unstable_cache`, which would shrink the page's revalidation window to a
// minute and change the HTML on every regeneration. The browser loads the
// current edge snapshot immediately on entry (see useLiveConflictFeed); this
// deterministic placeholder only marks the related-markets rail as pending.
const PENDING_FEED: ConflictPreviewFeed = {
  dataMode: "fallback",
  updatedAt: "1970-01-01T00:00:00.000Z",
  refreshSeconds: 60,
  minimumVolume: PREVIEW_MINIMUM_VOLUME,
  sourceLabel: "Polymarket Gamma API",
  sourceUrl: "https://docs.polymarket.com/market-data/fetching-markets",
  events: [],
  excludedCount: 0,
};

export async function ArticlePageContent({ slug, locale }: { slug: string; locale: Locale }) {
  const article = await getNewsArticle(slug);
  if (!article || (locale !== "en" && !article.translations[locale])) notFound();
  const structured = articleStructuredData(article, locale);
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, "\\u003c") }}/><NewsArticleView article={article} initialFeed={PENDING_FEED}/></>;
}
