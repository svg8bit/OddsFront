import { expect, test } from "@playwright/test";

import { getConflictPreviewFixtureFeed } from "../features/global-conflict-map/preview/fixture";
import {
  getInitialActivityClock,
  releaseAbsentActivityNoticeIds,
} from "../lib/activity-notice-lifecycle";
import { buildRollingActivitySignals } from "../lib/conflict-activity-signals";

test("uses a deterministic feed clock for the hydration frame", () => {
  const updatedAt = "2026-08-22T16:20:03.843Z";

  expect(getInitialActivityClock(updatedAt)).toBe(Date.parse(updatedAt));
  expect(getInitialActivityClock("invalid timestamp")).toBe(0);
});

test("builds both directions from 5% at 24h and 20% at 7d", () => {
  const now = Date.parse("2026-08-11T09:00:00.000Z");
  const fixture = getConflictPreviewFixtureFeed();
  const events = fixture.events.slice(0, 5).map((event, index) => ({
    ...event,
    id: `polymarket-${70_000 + index}`,
    marketUrl: `https://polymarket.com/event/rolling-signal-${index}`,
    updatedAt: new Date(now - 5 * 60_000).toISOString(),
    endDate: new Date(now + 24 * 60 * 60_000).toISOString(),
    marketConditionId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
    volume: [8_161_752, 483_019, 17_151_386, 99_999, 8_886_800][index]!,
    volume24h: [1, 2, 0, 20_000, 0][index]!,
    priceChange1h: [0.75, -0.81, 0.66, 0.9, -0.72][index]!,
    priceChange24h: [0.05, -0.05, 0.06, 0.8, 0.04996][index]!,
    priceChange7d: [0.199, -0.2, 0.25, -0.9, -0.19996][index]!,
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
      eventId: "polymarket-70002",
      windowLabel: "7d",
      value: 25,
    },
    {
      kind: "odds-drop",
      eventId: "polymarket-70001",
      windowLabel: "7d",
      value: 20,
    },
    {
      kind: "odds-rise",
      eventId: "polymarket-70000",
      windowLabel: "24h",
      value: 5,
    },
  ]);
  expect(signals.some((signal) => signal.eventId === "polymarket-70003")).toBe(
    false,
  );
  expect(signals.some((signal) => signal.eventId === "polymarket-70004")).toBe(
    false,
  );
});

test("rejects an expired market even when upstream still marks it active", () => {
  const now = Date.parse("2026-08-11T13:00:00Z");
  const fixture = getConflictPreviewFixtureFeed();
  const feed = {
    ...fixture,
    dataMode: "live" as const,
    updatedAt: new Date(now - 60_000).toISOString(),
    events: [
      {
        ...fixture.events[0]!,
        id: "polymarket-707496",
        volume: 8_247_216,
        volume24h: 635_662,
        priceChange1h: 0.08,
        priceChange24h: 0.14,
        endDate: "2026-07-31T23:59:00Z",
        marketConditionId: `0x${(707_496).toString(16).padStart(64, "0")}`,
      },
    ],
  };

  expect(buildRollingActivitySignals(feed, now)).toEqual([]);
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
      endDate: new Date(now + 24 * 60 * 60_000).toISOString(),
      marketConditionId: `0x${(71_000 + index).toString(16).padStart(64, "0")}`,
      priceChange1h: 0.2,
      priceChange24h: 0.3,
    })),
  };

  expect(buildRollingActivitySignals(feed, now)).toEqual([]);
});

test("keeps a rolling signal identity stable while its live value updates", () => {
  const now = Date.parse("2026-08-11T09:00:00.000Z");
  const fixture = getConflictPreviewFixtureFeed();
  const event = {
    ...fixture.events[0]!,
    id: "polymarket-72000",
    volume: 2_000_000,
    volume24h: 100_000,
    priceChange1h: 0.51,
    priceChange24h: 0.051,
    endDate: new Date(now + 24 * 60 * 60_000).toISOString(),
    marketConditionId: `0x${(72_000).toString(16).padStart(64, "0")}`,
  };
  const feed = {
    ...fixture,
    dataMode: "live" as const,
    updatedAt: new Date(now - 60_000).toISOString(),
    events: [event],
  };
  const updatedFeed = {
    ...feed,
    updatedAt: new Date(now).toISOString(),
    events: [
      {
        ...event,
        volume24h: 121_000,
        priceChange1h: 0.59,
        priceChange24h: 0.059,
      },
    ],
  };

  const firstSignal = buildRollingActivitySignals(feed, now)[0]!;
  const updatedSignal = buildRollingActivitySignals(updatedFeed, now)[0]!;

  expect(updatedSignal.id).toBe(firstSignal.id);
  expect(updatedSignal.value).not.toBe(firstSignal.value);
});

test("releases a rolling signal identity only after it disappears", () => {
  const seenNoticeIds = new Set([
    "rolling-24h-polymarket-72000-odds-rise",
    "rolling-7d-polymarket-72001-odds-drop",
    "trade-0x1234",
  ]);

  releaseAbsentActivityNoticeIds(
    seenNoticeIds,
    new Set([
      "rolling-24h-polymarket-72000-odds-rise",
      "rolling-7d-polymarket-72001-odds-drop",
    ]),
    new Set(["rolling-24h-polymarket-72000-odds-rise"]),
  );

  expect([...seenNoticeIds].sort()).toEqual([
    "rolling-24h-polymarket-72000-odds-rise",
    "trade-0x1234",
  ]);
});
