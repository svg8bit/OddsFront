import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";

import type {
  ConflictActivityFeed,
  ConflictTradeActivity,
} from "@/features/global-conflict-map/preview/types";
import {
  buildPolymarketActivityUrl,
  POLYMARKET_ACTIVITY_TTL_SECONDS,
  POLYMARKET_LARGE_TRADE_USD,
} from "@/lib/polymarket-activity-query";
import { buildPolymarketEventUrl } from "@/lib/polymarket-links";

const DATA_API_DOCS_URL =
  "https://docs.polymarket.com/api-reference/core/get-trades-for-a-user-or-markets";
const MAX_EVENT_IDS = 60;
const REQUEST_TIMEOUT_MS = 6_000;

interface DataApiTrade {
  side?: unknown;
  size?: unknown;
  price?: unknown;
  timestamp?: unknown;
  title?: unknown;
  eventSlug?: unknown;
  outcome?: unknown;
  transactionHash?: unknown;
}

function cleanText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replaceAll("…", "...").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 180) : fallback;
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function validEventIds(request: NextRequest): string[] {
  const raw = request.nextUrl.searchParams.get("eventIds") ?? "";
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter((value) => /^\d{1,12}$/.test(value)),
    ),
  )
    .slice(0, MAX_EVENT_IDS)
    .toSorted((left, right) => Number(left) - Number(right));
}

function normalizeTrade(
  trade: DataApiTrade,
  nowSeconds: number,
): ConflictTradeActivity | null {
  const side = trade.side === "BUY" || trade.side === "SELL" ? trade.side : null;
  const size = toFiniteNumber(trade.size);
  const price = toFiniteNumber(trade.price);
  const timestamp = toFiniteNumber(trade.timestamp);
  const marketUrl = buildPolymarketEventUrl(trade.eventSlug);
  if (!side || size === null || price === null || timestamp === null || !marketUrl) {
    return null;
  }

  const notional = Math.abs(size * price);
  if (
    notional < POLYMARKET_LARGE_TRADE_USD ||
    timestamp < nowSeconds - POLYMARKET_ACTIVITY_TTL_SECONDS ||
    timestamp > nowSeconds + 60
  ) {
    return null;
  }

  const transactionHash =
    typeof trade.transactionHash === "string" &&
    /^0x[a-f0-9]{64}$/i.test(trade.transactionHash)
      ? trade.transactionHash.toLowerCase()
      : null;
  const slug = trade.eventSlug as string;
  const id =
    transactionHash ??
    `${slug}-${side.toLowerCase()}-${Math.trunc(timestamp)}-${Math.round(notional)}`;

  return {
    id,
    kind: side === "BUY" ? "large-buy" : "large-sell",
    title: cleanText(trade.title, "Conflict market activity"),
    outcome: cleanText(trade.outcome, "Market"),
    notional,
    occurredAt: new Date(timestamp * 1_000).toISOString(),
    marketUrl,
  };
}

function response(
  feed: ConflictActivityFeed,
  cacheSeconds: number,
  status = 200,
) {
  return NextResponse.json(feed, {
    status,
    headers: {
      "Cache-Control":
        "public, max-age=10, stale-while-revalidate=30, stale-if-error=900",
      "CDN-Cache-Control": `public, max-age=${cacheSeconds}, stale-while-revalidate=120, stale-if-error=900`,
      "Vercel-CDN-Cache-Control": `public, max-age=${cacheSeconds}, stale-while-revalidate=120, stale-if-error=900`,
      ...(status === 503 ? { "Retry-After": "30" } : {}),
    },
  });
}

export const dynamic = "force-dynamic";
export const maxDuration = 10;

async function fetchActivityFeed(
  eventIds: string[],
): Promise<ConflictActivityFeed> {
  const now = new Date();
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const url = buildPolymarketActivityUrl(eventIds, nowSeconds);

  const upstream = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "DropsAnalytics/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!upstream.ok) {
    throw new Error(`Polymarket Data API returned ${upstream.status}`);
  }

  const payload: unknown = await upstream.json();
  if (!Array.isArray(payload)) throw new Error("Invalid activity response");
  const items = payload
    .map((item) => normalizeTrade(item as DataApiTrade, nowSeconds))
    .filter((item): item is ConflictTradeActivity => Boolean(item))
    .sort(
      (left, right) =>
        Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
        right.notional - left.notional,
    )
    .slice(0, 8);

  return {
    dataMode: "live",
    updatedAt: now.toISOString(),
    expiresAfterSeconds: POLYMARKET_ACTIVITY_TTL_SECONDS,
    sourceLabel: `Polymarket Data API · ${DATA_API_DOCS_URL}`,
    items,
  };
}

const getCachedActivityFeed = unstable_cache(
  fetchActivityFeed,
  ["oddsfront-live-conflict-activity-v3-useful-window"],
  {
    revalidate: 60,
    tags: ["oddsfront-live-conflict-activity"],
  },
);

const activityRefreshesInFlight = new Map<
  string,
  Promise<ConflictActivityFeed>
>();

async function getSingleFlightActivityFeed(eventIds: string[]) {
  const key = eventIds.join(",");
  const existing = activityRefreshesInFlight.get(key);
  if (existing) return existing;

  const request = getCachedActivityFeed(eventIds);
  activityRefreshesInFlight.set(key, request);
  try {
    return await request;
  } finally {
    if (activityRefreshesInFlight.get(key) === request) {
      activityRefreshesInFlight.delete(key);
    }
  }
}

export async function GET(request: NextRequest) {
  const eventIds = validEventIds(request);
  const now = new Date();
  if (eventIds.length === 0) {
    return response(
      {
        dataMode: "unavailable",
        updatedAt: now.toISOString(),
        expiresAfterSeconds: POLYMARKET_ACTIVITY_TTL_SECONDS,
        sourceLabel: "Polymarket Data API",
        items: [],
      },
      30,
    );
  }

  try {
    return response(await getSingleFlightActivityFeed(eventIds), 60);
  } catch (error) {
    console.warn(
      "Polymarket conflict activity unavailable.",
      error instanceof Error ? error.message : "Unknown error",
    );
    const status = process.env.NODE_ENV === "production" ? 503 : 200;
    return response(
      {
        dataMode: "unavailable",
        updatedAt: now.toISOString(),
        expiresAfterSeconds: POLYMARKET_ACTIVITY_TTL_SECONDS,
        sourceLabel: "Polymarket Data API",
        items: [],
      },
      30,
      status,
    );
  }
}
