const DATA_API_TRADES_URL = "https://data-api.polymarket.com/trades";

export const POLYMARKET_ACTIVITY_TTL_SECONDS = 30 * 60;
export const POLYMARKET_LARGE_TRADE_USD = 5_000;
export const POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME = 400_000;
export const POLYMARKET_ACTIVITY_MAX_EVENT_IDS = 200;
const POLYMARKET_ACTIVITY_QUERY_LIMIT = 500;

interface PolymarketActivityEventCandidate {
  id: string;
  volume: number;
}

export function selectPolymarketActivityEventIds(
  events: readonly PolymarketActivityEventCandidate[],
): string[] {
  const eligibleById = new Map<string, number>();
  for (const event of events) {
    const match = event.id.match(/^polymarket-(\d{1,12})$/);
    if (
      !match ||
      !Number.isFinite(event.volume) ||
      event.volume < POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME
    ) {
      continue;
    }
    const eventId = match[1]!;
    eligibleById.set(
      eventId,
      Math.max(eligibleById.get(eventId) ?? 0, event.volume),
    );
  }

  return [...eligibleById]
    .toSorted(
      ([leftId, leftVolume], [rightId, rightVolume]) =>
        rightVolume - leftVolume || Number(leftId) - Number(rightId),
    )
    .slice(0, POLYMARKET_ACTIVITY_MAX_EVENT_IDS)
    .map(([eventId]) => eventId)
    .toSorted((left, right) => Number(left) - Number(right));
}

export function buildPolymarketActivityUrl(
  eventIds: readonly string[],
  nowSeconds: number,
): URL {
  const normalizedEventIds = Array.from(
    new Set(eventIds.filter((eventId) => /^\d{1,12}$/.test(eventId))),
  )
    .toSorted((left, right) => Number(left) - Number(right))
    .slice(0, POLYMARKET_ACTIVITY_MAX_EVENT_IDS);
  const boundedNowSeconds = Math.trunc(nowSeconds);
  const url = new URL(DATA_API_TRADES_URL);
  url.searchParams.set("eventId", normalizedEventIds.join(","));
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
