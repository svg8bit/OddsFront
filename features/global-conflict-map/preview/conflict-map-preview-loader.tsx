"use client";

import dynamic from "next/dynamic";

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
  return (
    <ConflictMapPreview
      initialFeed={initialFeed}
      initialMarketStrip={initialMarketStrip}
      fixtureMode={fixtureMode}
    />
  );
}
