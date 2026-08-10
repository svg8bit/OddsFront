import type { Metadata } from "next";

import { ConflictMapPreviewLoader } from "@/features/global-conflict-map/preview/conflict-map-preview-loader";
import { getConflictPreviewFixtureFeed } from "@/features/global-conflict-map/preview/fixture";
import { getDropstabMarketStripFixture } from "@/lib/dropstab-market-strip";

export const metadata: Metadata = {
  title: "Interactive Global Conflict Map · DropsBot",
  description:
    "Interactive map for tracking active conflict and geopolitics prediction markets.",
};

export const dynamic = "force-dynamic";

interface GlobalConflictMapPreviewPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function GlobalConflictMapPreviewPage({
  searchParams,
}: GlobalConflictMapPreviewPageProps) {
  const params = await searchParams;
  const fixtureMode = params.fixture === "1";
  return (
    <ConflictMapPreviewLoader
      initialFeed={getConflictPreviewFixtureFeed()}
      initialMarketStrip={getDropstabMarketStripFixture()}
      fixtureMode={fixtureMode}
    />
  );
}
