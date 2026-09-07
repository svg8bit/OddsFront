import { unstable_cache } from "next/cache";
import type { ConflictPreviewFeed } from "@/features/global-conflict-map/preview/types";
import { priceMoveMarketEligible, recentPriceMove, PRICE_MOVE_WINDOW_MS } from "@/lib/conflict-price-moves";

const BATCH_LIMIT = 20;
const MAX_MARKETS = 200;
const REQUEST_TIMEOUT_MS = 2_000;

async function fetchPriceHistories(tokens: string[]): Promise<Record<string, unknown>> {
  const now = Date.now();
  // https://docs.polymarket.com/api-reference/markets/get-batch-prices-history
  const response = await fetch("https://clob.polymarket.com/batch-prices-history", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ markets: tokens, start_ts: Math.floor((now - 2 * PRICE_MOVE_WINDOW_MS - 180_000) / 1_000), end_ts: Math.floor(now / 1_000), fidelity: 1 }),
    cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Price history returned ${response.status}`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("history" in payload) || !payload.history || typeof payload.history !== "object" || Array.isArray(payload.history)) throw new Error("Invalid price history response");
  return payload.history as Record<string, unknown>;
}

const getHistories = unstable_cache(fetchPriceHistories, ["oddsfront-recent-price-history-v1"], { revalidate: 60 });

export async function withRecentPriceMoves(feed: ConflictPreviewFeed): Promise<ConflictPreviewFeed> {
  if (feed.dataMode !== "live") return feed;
  const now = Date.now();
  const eligible = feed.events.filter(event => priceMoveMarketEligible(event, now))
    .toSorted((a, b) => b.volume24h - a.volume24h).slice(0, MAX_MARKETS);
  const tokens = [...new Set(eligible.map(event => event.yesTokenId!))].sort();
  const batches: string[][] = [];
  for (let i = 0; i < tokens.length; i += BATCH_LIMIT) batches.push(tokens.slice(i, i + BATCH_LIMIT));
  const results = await Promise.allSettled(batches.map(batch => getHistories(batch)));
  const failed = results.filter(result => result.status === "rejected").length;
  if (failed) console.warn(`Recent price history: ${failed}/${batches.length} batches unavailable`);
  const histories = Object.assign({}, ...results.flatMap(result => result.status === "fulfilled" ? [result.value] : [])) as Record<string, unknown>;
  const eligibleIds = new Set(eligible.map(event => event.id));
  return { ...feed, priceMoveCoverage: { requestedMarkets: tokens.length, returnedMarkets: tokens.filter(token => Array.isArray(histories[token])).length }, events: feed.events.map(event => ({
    ...event,
    recentPriceMove: eligibleIds.has(event.id) ? recentPriceMove(histories[event.yesTokenId!], now) : null,
  })) };
}
