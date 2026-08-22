const DATA_API_TRADES_URL = "https://data-api.polymarket.com/trades";

export const POLYMARKET_ACTIVITY_TTL_SECONDS = 15 * 60;
export const POLYMARKET_LARGE_TRADE_USD = 200_000;
export const POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME = 100_000;
export const POLYMARKET_ACTIVITY_MAX_MARKET_IDS = 100;
const POLYMARKET_ACTIVITY_QUERY_LIMIT = 500;
const POLYMARKET_CONDITION_ID_PATTERN = /^0x[a-f0-9]{64}$/i;

interface PolymarketActivityMarketCandidate {
  id: string;
  volume: number;
  endDate: string | null;
  marketConditionId: string | null;
}

export function isPolymarketActivityEventCurrent(
  event: PolymarketActivityMarketCandidate,
  now = Date.now(),
): boolean {
  // The public map can still show an otherwise open market without a deadline,
  // but alerts fail closed unless freshness can be proven from a future date.
  const endAt = Date.parse(event.endDate ?? "");
  return (
    /^polymarket-\d{1,12}$/.test(event.id) &&
    Number.isFinite(event.volume) &&
    event.volume >= POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME &&
    Number.isFinite(endAt) &&
    endAt > now &&
    Boolean(
      event.marketConditionId &&
        POLYMARKET_CONDITION_ID_PATTERN.test(event.marketConditionId),
    )
  );
}

export function selectPolymarketActivityMarketIds(
  events: readonly PolymarketActivityMarketCandidate[],
  now = Date.now(),
): string[] {
  const eligibleById = new Map<string, number>();
  for (const event of events) {
    if (
      !isPolymarketActivityEventCurrent(event, now) ||
      !event.marketConditionId
    ) {
      continue;
    }
    const marketId = event.marketConditionId.toLowerCase();
    eligibleById.set(
      marketId,
      Math.max(eligibleById.get(marketId) ?? 0, event.volume),
    );
  }

  return [...eligibleById]
    .toSorted(
      ([leftId, leftVolume], [rightId, rightVolume]) =>
        rightVolume - leftVolume || leftId.localeCompare(rightId),
    )
    .map(([marketId]) => marketId)
    .toSorted((left, right) => left.localeCompare(right));
}

export function batchPolymarketActivityMarketIds(
  marketIds: readonly string[],
): string[][] {
  const normalizedMarketIds = Array.from(
    new Set(
      marketIds
        .filter((marketId) => POLYMARKET_CONDITION_ID_PATTERN.test(marketId))
        .map((marketId) => marketId.toLowerCase()),
    ),
  ).toSorted((left, right) => left.localeCompare(right));
  const batches: string[][] = [];
  for (
    let index = 0;
    index < normalizedMarketIds.length;
    index += POLYMARKET_ACTIVITY_MAX_MARKET_IDS
  ) {
    batches.push(
      normalizedMarketIds.slice(
        index,
        index + POLYMARKET_ACTIVITY_MAX_MARKET_IDS,
      ),
    );
  }
  return batches;
}

export function buildPolymarketActivityUrl(
  marketIds: readonly string[],
  nowSeconds: number,
): URL {
  const normalizedMarketIds = Array.from(
    new Set(
      marketIds
        .filter((marketId) => POLYMARKET_CONDITION_ID_PATTERN.test(marketId))
        .map((marketId) => marketId.toLowerCase()),
    ),
  )
    .toSorted((left, right) => left.localeCompare(right))
    .slice(0, POLYMARKET_ACTIVITY_MAX_MARKET_IDS);
  const boundedNowSeconds = Math.trunc(nowSeconds);
  const url = new URL(DATA_API_TRADES_URL);
  url.searchParams.set("market", normalizedMarketIds.join(","));
  url.searchParams.set("limit", String(POLYMARKET_ACTIVITY_QUERY_LIMIT));
  url.searchParams.set("takerOnly", "true");
  url.searchParams.set("filterType", "CASH");
  url.searchParams.set(
    "filterAmount",
    String(POLYMARKET_LARGE_TRADE_USD),
  );
  url.searchParams.set(
    "start",
    String(boundedNowSeconds - POLYMARKET_ACTIVITY_TTL_SECONDS),
  );
  url.searchParams.set("end", String(boundedNowSeconds + 60));
  return url;
}
