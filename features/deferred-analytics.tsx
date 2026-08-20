"use client";

import { useEffect, useState } from "react";

type AnalyticsComponent = typeof import("@vercel/analytics/next").Analytics;

export function DeferredAnalytics() {
  const [Analytics, setAnalytics] = useState<AnalyticsComponent | null>(null);

  useEffect(() => {
    let cancelled = false;
    const idleWindow = window as unknown as {
      requestIdleCallback?: typeof window.requestIdleCallback;
      cancelIdleCallback?: typeof window.cancelIdleCallback;
      setTimeout: typeof window.setTimeout;
      clearTimeout: typeof window.clearTimeout;
    };
    const load = () => {
      void import("@vercel/analytics/next")
        .then((module) => {
          if (!cancelled) setAnalytics(() => module.Analytics);
        })
        .catch((error: unknown) => {
          console.error("OddsFront analytics failed to initialize.", error);
        });
    };
    const usesIdleCallback = Boolean(idleWindow.requestIdleCallback);
    const idleId = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(load, { timeout: 3_000 })
      : idleWindow.setTimeout(load, 3_000);
    return () => {
      cancelled = true;
      if (usesIdleCallback && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleId);
      } else {
        idleWindow.clearTimeout(idleId);
      }
    };
  }, []);

  return Analytics ? <Analytics mode="production" /> : null;
}
