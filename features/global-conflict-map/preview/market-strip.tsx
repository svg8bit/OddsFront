"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import styles from "@/features/global-conflict-map/preview/market-strip.module.css";
import type {
  MarketStripAsset,
  MarketStripFeed,
} from "@/features/global-conflict-map/preview/market-strip-types";

interface MarketStripProps {
  initialFeed: MarketStripFeed;
  fixtureMode: boolean;
}

function formatPrice(value: number | null): string {
  if (value === null) return "—";
  const absolute = Math.abs(value);
  const maximumFractionDigits = absolute >= 1_000 ? 2 : absolute >= 1 ? 2 : 6;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}

function formatChange(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function changeDirection(value: number | null): "up" | "down" | "flat" {
  if (value === null || Math.abs(value) < 0.005) return "flat";
  return value > 0 ? "up" : "down";
}

function isMarketStripAsset(value: unknown): value is MarketStripAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<MarketStripAsset>;
  return (
    typeof asset.id === "string" &&
    typeof asset.displaySymbol === "string" &&
    typeof asset.name === "string" &&
    typeof asset.sourceSymbol === "string" &&
    typeof asset.slug === "string" &&
    (asset.price === null ||
      (typeof asset.price === "number" &&
        Number.isFinite(asset.price) &&
        asset.price > 0)) &&
    (asset.priceChange24h === null ||
      (typeof asset.priceChange24h === "number" &&
        Number.isFinite(asset.priceChange24h))) &&
    typeof asset.dropsBotUrl === "string" &&
    asset.dropsBotUrl.startsWith("https://t.me/Drops?start=dropstab_") &&
    typeof asset.dropstabUrl === "string" &&
    asset.dropstabUrl.startsWith("https://dropstab.com/coins/")
  );
}

function isMarketStripFeed(value: unknown): value is MarketStripFeed {
  if (!value || typeof value !== "object") return false;
  const feed = value as Partial<MarketStripFeed>;
  return (
    ["live", "partial", "unavailable"].includes(feed.dataMode ?? "") &&
    typeof feed.updatedAt === "string" &&
    typeof feed.refreshSeconds === "number" &&
    feed.refreshSeconds >= 60 &&
    typeof feed.sourceLabel === "string" &&
    Array.isArray(feed.assets) &&
    feed.assets.every(isMarketStripAsset)
  );
}

export function MarketStrip({ initialFeed, fixtureMode }: MarketStripProps) {
  const [feed, setFeed] = useState(initialFeed);
  const refreshInFlight = useRef(false);
  const lastRefreshAt = useRef(Date.parse(initialFeed.updatedAt) || 0);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const response = await fetch("/api/market-strip?schema=4", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload: unknown = await response.json();
      if (!isMarketStripFeed(payload) || payload.dataMode === "unavailable") {
        return;
      }
      lastRefreshAt.current = Date.now();
      setFeed(payload);
    } catch {
      // Preserve the last good strip without affecting the map experience.
    } finally {
      refreshInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (fixtureMode) return;
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const refreshMilliseconds = feed.refreshSeconds * 1_000;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, refreshMilliseconds);
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRefreshAt.current >= refreshMilliseconds
      ) {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [feed.refreshSeconds, fixtureMode, refresh]);

  return (
    <nav
      className={styles.strip}
      aria-label="DropsTab asset prices and 24-hour changes"
      data-market-strip="true"
      data-market-count={feed.assets.length}
      data-market-mode={feed.dataMode}
      data-market-updated-at={feed.updatedAt}
    >
      <div className={styles.track} data-market-strip-track="true">
        {feed.assets.map((asset, index) => (
          <span className={styles.slot} key={asset.id}>
            {index > 0 ? <i className={styles.separator} aria-hidden="true" /> : null}
            <a
              className={styles.asset}
              href={asset.dropsBotUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Track ${asset.name} in DropsBot`}
              title={`${asset.name} · Track in DropsBot`}
              data-asset-slug={asset.slug}
              data-asset-symbol={asset.displaySymbol}
              data-dropstab-url={asset.dropstabUrl}
            >
              <span
                className={styles.icon}
                data-icon={asset.id}
                aria-hidden="true"
              />
              <strong>{asset.displaySymbol}</strong>
              <span className={styles.price}>{formatPrice(asset.price)}</span>
              <span
                className={styles.change}
                data-direction={changeDirection(asset.priceChange24h)}
              >
                {formatChange(asset.priceChange24h)}
              </span>
            </a>
          </span>
        ))}
      </div>
    </nav>
  );
}
