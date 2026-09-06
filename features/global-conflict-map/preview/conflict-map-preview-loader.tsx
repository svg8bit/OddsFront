"use client";

import dynamic from "next/dynamic";
import { useCallback, useState, useSyncExternalStore } from "react";
import { SiteNavigation } from "@/components/site-navigation";
import { useLocale } from "@/components/locale-provider";

import { ActivityRail } from "@/features/global-conflict-map/preview/activity-rail";
import styles from "@/features/global-conflict-map/preview/conflict-map-preview.module.css";
import { useConflictMapPreviewStore } from "@/features/global-conflict-map/preview/store";
import { useLiveConflictFeed } from "@/features/global-conflict-map/preview/use-live-conflict-feed";
import type { ConflictPreviewFeed } from "@/features/global-conflict-map/preview/types";
import type { MarketStripFeed } from "@/features/global-conflict-map/preview/market-strip-types";

const ConflictMapPreview = dynamic(
  () =>
    import("@/features/global-conflict-map/preview/conflict-map-runtime").then(
      (module) => module.ConflictMapRuntime,
    ),
  {
    loading: () => null,
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
  const { t } = useLocale();
  const activityFeed = useLiveConflictFeed(initialFeed, fixtureMode);
  const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  const popupOpen = useConflictMapPreviewStore((state) => state.popupOpen);
  const [mapReady, setMapReady] = useState(false);
  const handleMapReady = useCallback(() => setMapReady(true), []);

  return (
    <div
      className={styles.mapLoaderRoot}
      data-popup-open={popupOpen ? "true" : "false"}
    >
      <link rel="modulepreload" href="/vendor/maplibre/6.1.0/maplibre-gl.mjs" crossOrigin="anonymous" />
      {popupOpen ? null : <SiteNavigation mode="map" />}
      <div className={styles.initialBasemap} aria-hidden="true" data-initial-basemap="true">
        <span>{t("loadingMap")}</span>
      </div>
      <ConflictMapPreview
        initialFeed={activityFeed}
        initialMarketStrip={initialMarketStrip}
        fixtureMode={fixtureMode}
        onReady={handleMapReady}
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
          newsRefreshEnabled={mapReady && !fixtureMode}
        /> : null}
      </div>
    </div>
  );
}
