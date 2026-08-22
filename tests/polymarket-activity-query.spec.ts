import { expect, test } from "@playwright/test";

import {
  buildPolymarketActivityUrl,
  selectPolymarketActivityMarketIds,
} from "../lib/polymarket-activity-query";

function conditionId(index: number): string {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

test("selects exact future liquid markets and rejects expired child markets", () => {
  const now = Date.parse("2026-08-11T13:00:00Z");
  const liquidEvents = Array.from({ length: 72 }, (_, index) => ({
    id: `polymarket-${700_000 + index}`,
    volume: 400_000 + index,
    endDate: "2026-08-31T23:59:00Z",
    marketConditionId: conditionId(index + 1),
  }));

  const marketIds = selectPolymarketActivityMarketIds([
    ...liquidEvents,
    {
      id: "polymarket-699997",
      volume: 12_000_000,
      endDate: "2026-07-31T23:59:00Z",
      marketConditionId: conditionId(997),
    },
    {
      id: "polymarket-699998",
      volume: 11_000_000,
      endDate: "2026-08-31T23:59:00Z",
      marketConditionId: null,
    },
    {
      id: "polymarket-699999",
      volume: 399_999,
      endDate: "2026-08-31T23:59:00Z",
      marketConditionId: conditionId(999),
    },
    {
      id: "fixture-event",
      volume: 10_000_000,
      endDate: "2026-08-31T23:59:00Z",
      marketConditionId: conditionId(1_000),
    },
  ], now);

  expect(marketIds).toHaveLength(72);
  expect(marketIds).toContain(conditionId(1));
  expect(marketIds).toContain(conditionId(72));
  expect(marketIds).not.toContain(conditionId(997));
  expect(marketIds).not.toContain(conditionId(999));
  expect(marketIds).not.toContain(conditionId(1_000));
});

test("caps exact-market coverage at the highest-volume one hundred", () => {
  const now = Date.parse("2026-08-11T13:00:00Z");
  const events = Array.from({ length: 130 }, (_, index) => ({
    id: `polymarket-${710_000 + index}`,
    volume: 400_000 + index,
    endDate: "2026-08-31T23:59:00Z",
    marketConditionId: conditionId(index + 1),
  }));

  const marketIds = selectPolymarketActivityMarketIds(events, now);

  expect(marketIds).toHaveLength(100);
  expect(marketIds).toContain(conditionId(130));
  expect(marketIds).not.toContain(conditionId(1));
});

test("bounds the Polymarket trade query to a fresh fifteen-minute window", () => {
  const nowSeconds = 1_786_435_200;
  const firstMarket = conditionId(1);
  const secondMarket = conditionId(2);
  const url = buildPolymarketActivityUrl(
    [secondMarket, firstMarket, secondMarket],
    nowSeconds,
  );

  expect(url.origin + url.pathname).toBe(
    "https://data-api.polymarket.com/trades",
  );
  expect(url.searchParams.get("market")).toBe(
    `${firstMarket},${secondMarket}`,
  );
  expect(url.searchParams.has("eventId")).toBe(false);
  expect(url.searchParams.get("start")).toBe(String(nowSeconds - 15 * 60));
  expect(url.searchParams.get("end")).toBe(String(nowSeconds + 60));
  expect(url.searchParams.get("limit")).toBe("500");
  expect(url.searchParams.get("filterType")).toBe("CASH");
  expect(url.searchParams.get("filterAmount")).toBe("200000");
});
