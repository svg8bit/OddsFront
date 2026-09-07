"use client";

import { useEffect } from "react";

const READING_SECONDS = 5;

export function useArticleReadership(slug: string) {
  useEffect(() => {
    const day = Math.floor(Date.now() / 86_400_000);
    const recordedKey = `oddsfront:read:${day}:${slug}`;
    let sessionId: string;
    try {
      if (sessionStorage.getItem(recordedKey)) return;
      sessionId = sessionStorage.getItem("oddsfront:reading-session") || crypto.randomUUID();
      sessionStorage.setItem("oddsfront:reading-session", sessionId);
    } catch {
      // Reading the article never depends on browser storage being available.
      return;
    }
    let visibleSeconds = 0;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      visibleSeconds += 1;
      if (visibleSeconds < READING_SECONDS) return;
      window.clearInterval(timer);
      void fetch(`/api/news/${encodeURIComponent(slug)}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
        cache: "no-store",
        signal: controller.signal,
      }).then(response => {
        if (response.ok) sessionStorage.setItem(recordedKey, "1");
      }).catch(() => {});
    }, 1_000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [slug]);
}
