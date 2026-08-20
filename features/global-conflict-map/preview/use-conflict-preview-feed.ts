"use client";

import { useEffect, useState } from "react";

import type { ConflictPreviewFeed } from "@/features/global-conflict-map/preview/types";

const FEED_REFRESH_JITTER_MS = 30_000;

function isConflictPreviewFeed(value: unknown): value is ConflictPreviewFeed {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ConflictPreviewFeed>;
  return (
    (candidate.dataMode === "live" || candidate.dataMode === "fallback") &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.refreshSeconds === "number" &&
    typeof candidate.minimumVolume === "number" &&
    Array.isArray(candidate.events) &&
    candidate.events.every(
      (event) =>
        event &&
        typeof event.id === "string" &&
        typeof event.title === "string" &&
        Array.isArray(event.coordinates) &&
        event.coordinates.length === 2 &&
        ["place", "country", "regional", "alliance"].includes(
          event.geographyKind,
        ) &&
        typeof event.volume === "number" &&
        event.volume >= candidate.minimumVolume!,
    )
  );
}

export function useConflictPreviewFeed(
  initialFeed: ConflictPreviewFeed,
  fixtureMode: boolean,
) {
  const [feed, setFeed] = useState(initialFeed);

  useEffect(() => {
    if (fixtureMode) return;

    let cancelled = false;
    let timer: number | null = null;
    let controller: AbortController | null = null;
    const refresh = async () => {
      if (controller) return;
      controller = new AbortController();
      try {
        const response = await fetch("/api/global-conflict-events", {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (!cancelled && isConflictPreviewFeed(payload)) setFeed(payload);
      } catch {
        // Preserve the last verified feed on transient or offline failures.
      } finally {
        controller = null;
      }
    };

    const refreshMs = Math.max(60, feed.refreshSeconds) * 1_000;
    const schedule = (delay: number) => {
      timer = window.setTimeout(async () => {
        if (document.visibilityState === "visible") await refresh();
        if (!cancelled) {
          schedule(
            refreshMs + Math.floor(Math.random() * FEED_REFRESH_JITTER_MS),
          );
        }
      }, delay);
    };
    const refreshWhenOnline = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", refreshWhenOnline);
    const feedUpdatedAt = Date.parse(feed.updatedAt);
    const feedAge = Number.isFinite(feedUpdatedAt)
      ? Math.max(0, Date.now() - feedUpdatedAt)
      : refreshMs;
    const remainingFreshness = Math.max(0, refreshMs - feedAge);
    schedule(
      remainingFreshness === 0
        ? 0
        : remainingFreshness +
            Math.floor(Math.random() * FEED_REFRESH_JITTER_MS),
    );
    return () => {
      cancelled = true;
      window.removeEventListener("online", refreshWhenOnline);
      controller?.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [feed.refreshSeconds, feed.updatedAt, fixtureMode]);

  return feed;
}
