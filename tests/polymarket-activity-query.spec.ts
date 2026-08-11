import { expect, test } from "@playwright/test";

import {
  buildPolymarketActivityUrl,
  selectPolymarketActivityEventIds,
} from "../lib/polymarket-activity-query";

test("covers every liquid conflict event instead of truncating at sixty", () => {
  const liquidEvents = Array.from({ length: 72 }, (_, index) => ({
    id: `polymarket-${700_000 + index}`,
    volume: 400_000 + index,
  }));

  const eventIds = selectPolymarketActivityEventIds([
    ...liquidEvents,
    { id: "polymarket-699999", volume: 399_999 },
    { id: "fixture-event", volume: 10_000_000 },
  ]);

  expect(eventIds).toHaveLength(72);
  expect(eventIds).toContain("700000");
  expect(eventIds).toContain("700071");
  expect(eventIds).not.toContain("699999");
});

test("bounds the Polymarket trade query to a fresh thirty-minute window", () => {
  const nowSeconds = 1_786_435_200;
  const url = buildPolymarketActivityUrl(
    ["699735", "628311", "699735"],
    nowSeconds,
  );

  expect(url.origin + url.pathname).toBe(
    "https://data-api.polymarket.com/trades",
  );
  expect(url.searchParams.get("eventId")).toBe("628311,699735");
  expect(url.searchParams.get("start")).toBe(String(nowSeconds - 30 * 60));
  expect(url.searchParams.get("end")).toBe(String(nowSeconds + 60));
  expect(url.searchParams.get("limit")).toBe("500");
  expect(url.searchParams.get("filterType")).toBe("CASH");
  expect(url.searchParams.get("filterAmount")).toBe("5000");
});
