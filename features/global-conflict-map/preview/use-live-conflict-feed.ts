"use client";

import { useEffect, useState } from "react";

import type { ConflictPreviewFeed } from "./types";

function isLiveFeed(value: unknown): value is ConflictPreviewFeed {
  if (!value || typeof value !== "object") return false;
  const feed = value as Partial<ConflictPreviewFeed>;
  return (
    feed.dataMode === "live" &&
    typeof feed.updatedAt === "string" &&
    Number.isFinite(Date.parse(feed.updatedAt)) &&
    Date.parse(feed.updatedAt) <= Date.now() + 60_000 &&
    typeof feed.refreshSeconds === "number" && feed.refreshSeconds > 0 &&
    typeof feed.minimumVolume === "number" &&
    Array.isArray(feed.events) && feed.events.length > 0 &&
    feed.events.every((event) =>
      event && typeof event.id === "string" && typeof event.title === "string" &&
      Array.isArray(event.coordinates) && event.coordinates.length === 2 &&
      event.coordinates.every(Number.isFinite) &&
      ["place", "country", "regional", "alliance"].includes(event.geographyKind) &&
      typeof event.volume === "number" && event.volume >= feed.minimumVolume!
    )
  );
}

/** Keep data refresh independent of the deferred WebGL bundle and canvas. */
export function useLiveConflictFeed(initialFeed: ConflictPreviewFeed, fixtureMode: boolean) {
  const [feed, setFeed] = useState(initialFeed);

  useEffect(() => {
    if (fixtureMode) return;
    let cancelled = false;
    let timer = 0;
    let controller: AbortController | null = null;
    let requestStartedAt = 0;

    const refresh = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      // Mobile browsers freeze timers in the background. Do not let a request
      // from before suspension block the first refresh when the user returns.
      if (controller && Date.now() - requestStartedAt >= 12_000) {
        controller.abort();
        controller = null;
      }
      if (controller) return;
      const request = new AbortController();
      controller = request;
      requestStartedAt = Date.now();
      const timeout = window.setTimeout(() => request.abort(), 12_000);
      try {
        const response = await fetch("/api/global-conflict-events", {
          headers: { Accept: "application/json" },
          cache: "no-store",
          priority: "low",
          signal: request.signal,
        });
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (!cancelled && isLiveFeed(payload)) {
          setFeed((current) =>
            current.dataMode !== "live" || Date.parse(payload.updatedAt) > Date.parse(current.updatedAt)
              ? payload : current,
          );
        }
      } catch {
        // A timeout, offline state or bad response never erases verified data.
      } finally {
        window.clearTimeout(timeout);
        if (controller === request) controller = null;
      }
    };
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await refresh();
        if (!cancelled) schedule(60_000 + Math.floor(Math.random() * 5_000));
      }, delay);
    };
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      void refresh();
      schedule(60_000);
    };
    // Even a freshly prerendered page checks the current edge snapshot on entry.
    schedule(0);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [fixtureMode]);

  return feed;
}
