const DATA_API_TRADES_URL = "https://data-api.polymarket.com/trades";

export const POLYMARKET_ACTIVITY_TTL_SECONDS = 15 * 60;
export const POLYMARKET_LARGE_TRADE_USD = 10_000;

export function buildPolymarketActivityUrl(
  eventIds: readonly string[],
  nowSeconds: number,
): URL {
  const normalizedEventIds = Array.from(
    new Set(eventIds.filter((eventId) => /^\d{1,12}$/.test(eventId))),
  ).toSorted((left, right) => Number(left) - Number(right));
  const boundedNowSeconds = Math.trunc(nowSeconds);
  const url = new URL(DATA_API_TRADES_URL);
  url.searchParams.set("eventId", normalizedEventIds.join(","));
  url.searchParams.set("limit", "100");
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
