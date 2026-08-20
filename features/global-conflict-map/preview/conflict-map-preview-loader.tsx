"use client";

import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import bootstrapStyles from "@/features/global-conflict-map/preview/adaptive-map-bootstrap.module.css";
import type { LiteConflictMapProps } from "@/features/global-conflict-map/preview/lite-conflict-map";
import type { ConflictPreviewFeed } from "@/features/global-conflict-map/preview/types";
import type { MarketStripFeed } from "@/features/global-conflict-map/preview/market-strip-types";
import {
  selectMapExperience,
  type MapExperience,
} from "@/lib/client-performance-profile";

interface ConflictMapPreviewLoaderProps {
  initialFeed: ConflictPreviewFeed;
  initialMarketStrip: MarketStripFeed;
  fixtureMode: boolean;
}

type ConflictMapComponent = ComponentType<ConflictMapPreviewLoaderProps>;
type LiteMapComponent = ComponentType<LiteConflictMapProps>;

interface NavigatorPerformanceHints extends Navigator {
  connection?: {
    saveData?: boolean;
    effectiveType?: string;
  };
  deviceMemory?: number;
}

function forcedMapExperience(): MapExperience | null {
  const requested = new URLSearchParams(window.location.search).get("map");
  return requested === "full" || requested === "lite" ? requested : null;
}

function readMapExperience(): MapExperience {
  const hints = navigator as NavigatorPerformanceHints;
  return selectMapExperience({
    viewportWidth: window.innerWidth,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    saveData: Boolean(hints.connection?.saveData),
    effectiveType: hints.connection?.effectiveType ?? null,
    deviceMemory: hints.deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    forcedExperience: forcedMapExperience(),
  });
}

function subscribeToStaticCapabilities() {
  return () => undefined;
}

function MapBootstrap({
  experience,
  onRetry,
}: {
  experience: MapExperience | null;
  onRetry?: () => void;
}) {
  return (
    <main
      className={bootstrapStyles.bootstrapMain}
      data-map-ready="false"
      data-map-mode="bootstrap"
      aria-label="Preparing conflict map"
    >
      {onRetry ? (
        <button
          type="button"
          className={bootstrapStyles.status}
          onClick={onRetry}
        >
          Retry Lite map
        </button>
      ) : (
        <span className={bootstrapStyles.status} role="status">
          {experience === "lite" ? "Preparing Lite map…" : "Preparing map…"}
        </span>
      )}
    </main>
  );
}

export function ConflictMapPreviewLoader({
  initialFeed,
  initialMarketStrip,
  fixtureMode,
}: ConflictMapPreviewLoaderProps) {
  const detailedLoadingPromise = useRef<Promise<void> | null>(null);
  const liteLoadingPromise = useRef<Promise<void> | null>(null);
  const detectedExperience = useSyncExternalStore(
    subscribeToStaticCapabilities,
    readMapExperience,
    () => null,
  );
  const [detailedFailed, setDetailedFailed] = useState(false);
  const [liteFailed, setLiteFailed] = useState(false);
  const experience = detailedFailed ? "lite" : detectedExperience;
  const [DetailedMap, setDetailedMap] =
    useState<ConflictMapComponent | null>(null);
  const [LiteMap, setLiteMap] = useState<LiteMapComponent | null>(null);
  const [interactiveLoading, setInteractiveLoading] = useState(false);

  const loadDetailedMap = useCallback(() => {
    if (DetailedMap || detailedLoadingPromise.current) return;
    setDetailedFailed(false);
    setInteractiveLoading(true);
    const request = import(
      "@/features/global-conflict-map/preview/conflict-map-preview"
    )
      .then((module) => {
        setDetailedMap(() => module.ConflictMapPreview);
      })
      .catch((error: unknown) => {
        console.error(
          "OddsFront detailed map failed to load; preserving Lite mode.",
          error,
        );
        setDetailedFailed(true);
      })
      .finally(() => {
        detailedLoadingPromise.current = null;
        setInteractiveLoading(false);
      });
    detailedLoadingPromise.current = request;
  }, [DetailedMap]);

  const loadLiteMap = useCallback(() => {
    if (LiteMap || liteLoadingPromise.current) return;
    setLiteFailed(false);
    const request = import(
      "@/features/global-conflict-map/preview/lite-conflict-map"
    )
      .then((module) => {
        setLiteMap(() => module.LiteConflictMap);
      })
      .catch((error: unknown) => {
        console.error("OddsFront Lite map failed to load.", error);
        setLiteFailed(true);
      })
      .finally(() => {
        liteLoadingPromise.current = null;
      });
    liteLoadingPromise.current = request;
  }, [LiteMap]);

  useEffect(() => {
    if (experience === "full") loadDetailedMap();
    else if (experience === "lite") loadLiteMap();
  }, [experience, loadDetailedMap, loadLiteMap]);

  useEffect(() => {
    if (!liteFailed) return;
    window.addEventListener("online", loadLiteMap);
    return () => window.removeEventListener("online", loadLiteMap);
  }, [liteFailed, loadLiteMap]);

  let content: ReactNode;
  if (DetailedMap) {
    content = (
      <DetailedMap
        initialFeed={initialFeed}
        initialMarketStrip={initialMarketStrip}
        fixtureMode={fixtureMode}
      />
    );
  } else if (experience === "lite" && LiteMap) {
    content = (
      <LiteMap
        initialFeed={initialFeed}
        initialMarketStrip={initialMarketStrip}
        fixtureMode={fixtureMode}
        interactiveLoading={interactiveLoading}
        onEnableInteractive={loadDetailedMap}
      />
    );
  } else {
    content = (
      <MapBootstrap
        experience={experience}
        onRetry={experience === "lite" && liteFailed ? loadLiteMap : undefined}
      />
    );
  }

  return (
    <div
      className={bootstrapStyles.host}
      data-experience={experience ?? "checking"}
    >
      <div className={bootstrapStyles.background} aria-hidden="true" />
      {content}
    </div>
  );
}
