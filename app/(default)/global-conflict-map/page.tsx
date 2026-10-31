import type { Metadata } from "next";

import { ConflictMapPreviewLoader } from "@/features/global-conflict-map/preview/conflict-map-preview-loader";
import { getDropstabMarketStrip } from "@/lib/dropstab-market-strip";
import { buildOddsFrontSocialMetadata } from "@/lib/oddsfront-site";
import { getConflictPreviewFeedForPage } from "@/lib/polymarket-conflict-preview";

export const metadata: Metadata = {
  ...buildOddsFrontSocialMetadata("/global-conflict-map"),
  alternates: {
    canonical: "/global-conflict-map",
  },
};

export const dynamic = "force-static";
// Same window as the page's feed copy and the market strip; the browser refreshes live data on entry.
export const revalidate = 900;

export default async function GlobalConflictMapPage() {
  const [initialFeed, initialMarketStrip] = await Promise.all([
    getConflictPreviewFeedForPage(),
    getDropstabMarketStrip(),
  ]);
  if (
    process.env.VERCEL_ENV === "production" &&
    initialFeed.dataMode !== "live"
  ) {
    throw new Error(
      "Refusing to replace the production ISR page with fallback conflict data.",
    );
  }
  return (
    <ConflictMapPreviewLoader
      initialFeed={initialFeed}
      initialMarketStrip={initialMarketStrip}
      fixtureMode={false}
    />
  );
}
