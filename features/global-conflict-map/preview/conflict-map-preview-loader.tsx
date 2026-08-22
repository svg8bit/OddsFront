"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import { ActivityRail } from "@/features/global-conflict-map/preview/activity-rail";
import styles from "@/features/global-conflict-map/preview/conflict-map-preview.module.css";
import { useConflictMapPreviewStore } from "@/features/global-conflict-map/preview/store";
import type { ConflictPreviewFeed } from "@/features/global-conflict-map/preview/types";
import type { MarketStripFeed } from "@/features/global-conflict-map/preview/market-strip-types";

const ConflictMapPreview = dynamic(
  () =>
    import("@/features/global-conflict-map/preview/conflict-map-preview").then(
      (module) => module.ConflictMapPreview,
    ),
  {
    ssr: false,
    loading: () => (
      <main
        style={{
          display: "grid",
          width: "100vw",
          height: "100dvh",
          placeItems: "center",
          background: "#050D18",
          color: "#91A1B7",
          font: "500 13px Inter, sans-serif",
        }}
        aria-label="Loading conflict map preview"
      >
        Preparing map preview…
      </main>
    ),
  },
);

interface ConflictMapPreviewLoaderProps {
  initialFeed: ConflictPreviewFeed;
  initialMarketStrip: MarketStripFeed;
  fixtureMode: boolean;
}

export function ConflictMapPreviewLoader({
  initialFeed,
  initialMarketStrip,
  fixtureMode,
}: ConflictMapPreviewLoaderProps) {
  const [activityFeed, setActivityFeed] = useState(initialFeed);
  const popupOpen = useConflictMapPreviewStore((state) => state.popupOpen);
  const handleFeedChange = useCallback((feed: ConflictPreviewFeed) => {
    setActivityFeed(feed);
  }, []);

  return (
    <div
      className={styles.mapLoaderRoot}
      data-popup-open={popupOpen ? "true" : "false"}
    >
      <ConflictMapPreview
        initialFeed={initialFeed}
        initialMarketStrip={initialMarketStrip}
        fixtureMode={fixtureMode}
        onFeedChange={handleFeedChange}
      />
      <div
        className={styles.externalActivityLayer}
        data-activity-layer="ready"
        data-activity-feed-updated-at={activityFeed.updatedAt}
      >
        <ActivityRail
          feed={activityFeed}
          fixtureMode={fixtureMode}
          liveRefreshEnabled={!fixtureMode}
        />
      </div>
    </div>
  );
}
