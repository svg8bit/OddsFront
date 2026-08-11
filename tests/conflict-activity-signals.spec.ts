import { expect, test } from "@playwright/test";

import { getConflictPreviewFixtureFeed } from "../features/global-conflict-map/preview/fixture";
import { buildRollingActivitySignals } from "../lib/conflict-activity-signals";

test("builds diverse liquid rolling signals and rejects noisy movers", () => {
  const now = Date.parse("2026-08-11T09:00:00.000Z");
  const fixture = getConflictPreviewFixtureFeed();
  const events = fixture.events.slice(0, 5).map((event, index) => ({
    ...event,
    id: `polymarket-${70_000 + index}`,
    marketUrl: `https://polymarket.com/event/rolling-signal-${index}`,
    updatedAt: new Date(now - 5 * 60_000).toISOString(),
    volume: [8_161_752, 183_019, 17_151_386, 80_729, 8_886_800][index]!,
    volume24h: [20_540, 20_046, 421_439, 1_316, 21_645][index]!,
    priceChange1h: [0.015, 0.005, null, 0.235, -0.01][index]!,
    priceChange24h: [0.015, -0.11, null, 0.235, -0.07][index]!,
  }));
  const feed = {
    ...fixture,
    dataMode: "live" as const,
    updatedAt: new Date(now - 5 * 60_000).toISOString(),
    events,
  };

  const signals = buildRollingActivitySignals(feed, now);

  expect(signals).toHaveLength(3);
  expect(signals.map(({ kind, eventId, windowLabel, value }) => ({
    kind,
    eventId,
    windowLabel,
    value,
  }))).toEqual([
    {
      kind: "odds-rise",
      eventId: "polymarket-70000",
      windowLabel: "1h",
      value: 1.5,
    },
    {
      kind: "odds-drop",
      eventId: "polymarket-70001",
      windowLabel: "24h",
      value: 11,
    },
    {
      kind: "high-volume",
      eventId: "polymarket-70002",
      windowLabel: "24h",
      value: 421_439,
    },
  ]);
  expect(signals.some((signal) => signal.eventId === "polymarket-70003")).toBe(
    false,
  );
});

test("does not turn a stale rolling snapshot into a fresh alert", () => {
  const now = Date.parse("2026-08-11T09:00:00.000Z");
  const fixture = getConflictPreviewFixtureFeed();
  const feed = {
    ...fixture,
    dataMode: "live" as const,
    updatedAt: new Date(now - 31 * 60_000).toISOString(),
    events: fixture.events.map((event, index) => ({
      ...event,
      id: `polymarket-${71_000 + index}`,
      marketUrl: `https://polymarket.com/event/stale-signal-${index}`,
      priceChange1h: 0.2,
      priceChange24h: 0.3,
    })),
  };

  expect(buildRollingActivitySignals(feed, now)).toEqual([]);
});
