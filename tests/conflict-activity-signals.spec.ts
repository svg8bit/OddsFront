import { expect, test } from "@playwright/test";
import { getConflictPreviewFixtureFeed } from "../features/global-conflict-map/preview/fixture";
import { buildRollingActivitySignals, ACTIVITY_DISPLAY_TTL_MS } from "../lib/conflict-activity-signals";

const now = Date.parse("2026-09-07T13:00:00Z");
const fixture = getConflictPreviewFixtureFeed();
const event = { ...fixture.events[0]!, id: "polymarket-73000", volume: 2_000_000, marketVolume: 200_000,
  marketConditionId: `0x${"1".padStart(64, "0")}`, endDate: new Date(now + 86_400_000).toISOString(),
  updatedAt: new Date(now).toISOString(), priceChange24h: .3, priceChange7d: .7 };
const feed = { ...fixture, dataMode: "live" as const, updatedAt: new Date(now).toISOString(), events: [
  event,
  { ...event, id: "polymarket-73001", priceChange24h: -.12, priceChange7d: -.4 },
  { ...event, id: "polymarket-73002", priceChange24h: .08, priceChange7d: .25 },
] };

test("restores both day and week leaders without requiring a sudden intraday move", () => {
  const signals = buildRollingActivitySignals(feed, now, now);
  expect(signals).toHaveLength(3);
  expect(new Set(signals.map(item => item.windowLabel))).toEqual(new Set(["24H", "7D"]));
  expect(new Set(signals.map(item => item.kind))).toEqual(new Set(["odds-rise", "odds-drop"]));
  expect(new Set(signals.map(item => item.eventId)).size).toBe(3);
  expect(signals.every(item => item.observedAt === now && item.expiresAt === now + ACTIVITY_DISPLAY_TTL_MS)).toBe(true);
});

test("refreshed values do not extend display expiry and the next cycle creates current notices", () => {
  const first = buildRollingActivitySignals(feed, now, now);
  const nextTime = now + 9 * 60_000;
  const refreshed = buildRollingActivitySignals({ ...feed, updatedAt: new Date(nextTime).toISOString() }, nextTime, now);
  expect(refreshed.map(item => item.id)).toEqual(first.map(item => item.id));
  expect(refreshed.map(item => item.expiresAt)).toEqual(first.map(item => item.expiresAt));
  const newCycle = now + ACTIVITY_DISPLAY_TTL_MS;
  const rotated = buildRollingActivitySignals({ ...feed, updatedAt: new Date(newCycle).toISOString() }, newCycle, now);
  expect(rotated).toHaveLength(3);
  expect(rotated.every(item => !first.some(previous => previous.id === item.id))).toBe(true);
  expect(rotated.every(item => item.expiresAt === newCycle + ACTIVITY_DISPLAY_TTL_MS)).toBe(true);
});

test("excludes stale feeds, expired markets, low market volume and invalid changes", () => {
  expect(buildRollingActivitySignals({ ...feed, updatedAt: new Date(now - 3_600_000).toISOString() }, now)).toEqual([]);
  expect(buildRollingActivitySignals({ ...feed, dataMode: "fallback" }, now)).toEqual([]);
  for (const rejected of [
    { ...event, endDate: new Date(now - 1).toISOString() }, { ...event, marketVolume: 99_999 },
    { ...event, priceChange24h: .049, priceChange7d: -.199 },
    { ...event, priceChange24h: NaN, priceChange7d: Infinity },
  ]) expect(buildRollingActivitySignals({ ...feed, events: [rejected] }, now)).toEqual([]);
});
