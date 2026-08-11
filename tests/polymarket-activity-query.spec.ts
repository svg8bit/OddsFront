import { expect, test } from "@playwright/test";

import { buildPolymarketActivityUrl } from "../lib/polymarket-activity-query";

test("bounds the Polymarket activity query to the live alert TTL", () => {
  const nowSeconds = 1_786_435_200;
  const url = buildPolymarketActivityUrl(
    ["699735", "628311", "699735"],
    nowSeconds,
  );

  expect(url.origin + url.pathname).toBe(
    "https://data-api.polymarket.com/trades",
  );
  expect(url.searchParams.get("eventId")).toBe("628311,699735");
  expect(url.searchParams.get("start")).toBe(String(nowSeconds - 15 * 60));
  expect(url.searchParams.get("end")).toBe(String(nowSeconds + 60));
  expect(url.searchParams.get("filterType")).toBe("CASH");
  expect(url.searchParams.get("filterAmount")).toBe("10000");
});
