"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

import { ActivityRail } from "@/features/global-conflict-map/preview/activity-rail";
import styles from "@/features/global-conflict-map/preview/conflict-map-preview.module.css";
import { useConflictMapPreviewStore } from "@/features/global-conflict-map/preview/store";
import { useLiveConflictFeed } from "@/features/global-conflict-map/preview/use-live-conflict-feed";
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

const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function ConflictMapPreviewLoader({
  initialFeed,
  initialMarketStrip,
  fixtureMode,
}: ConflictMapPreviewLoaderProps) {
  const activityFeed = useLiveConflictFeed(initialFeed, fixtureMode);
  const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  const popupOpen = useConflictMapPreviewStore((state) => state.popupOpen);

  return (
    <div
      className={styles.mapLoaderRoot}
      data-popup-open={popupOpen ? "true" : "false"}
    >
      <div className={styles.initialBasemap} aria-hidden="true" data-initial-basemap="true">
        <span>Loading live map…</span>
      </div>
      <ConflictMapPreview
        initialFeed={activityFeed}
        initialMarketStrip={initialMarketStrip}
        fixtureMode={fixtureMode}
      />
      <div
        className={styles.externalActivityLayer}
        data-activity-layer="ready"
        data-activity-feed-updated-at={activityFeed.updatedAt}
      >
        {hydrated ? <ActivityRail
          feed={activityFeed}
          fixtureMode={fixtureMode}
          liveRefreshEnabled={!fixtureMode}
        /> : null}
      </div>
    </div>
  );
}
