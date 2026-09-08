import { expect, test } from "@playwright/test";
import { getConflictPreviewFixtureFeed } from "../features/global-conflict-map/preview/fixture";
import { buildRollingActivitySignals, ACTIVITY_DISPLAY_TTL_MS } from "../lib/conflict-activity-signals";
import { activeActivityDismissals } from "../lib/activity-notice-lifecycle";

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

test("six eligible markets rotate in distinct full pages", () => {
  const events = Array.from({ length: 6 }, (_, index) => ({ ...event, id: `polymarket-${73000 + index}` }));
  let previous = new Set<string>();
  for (let cycle = 0; cycle < 5; cycle++) {
    const timestamp = now + cycle * ACTIVITY_DISPLAY_TTL_MS;
    const signals = buildRollingActivitySignals({ ...feed, events, updatedAt: new Date(timestamp).toISOString() }, timestamp, now);
    expect(signals).toHaveLength(3);
    expect(signals.every(signal => !previous.has(signal.eventId))).toBe(true);
    previous = new Set(signals.map(signal => signal.eventId));
  }
});

test("small and uneven pools never create empty cycles or hide usable slots", () => {
  for (const count of [1, 2, 3, 4, 5, 7]) {
    const events = Array.from({ length: count }, (_, index) => ({ ...event, id: `polymarket-${73000 + index}` }));
    const seen = new Set<string>();
    for (let cycle = 0; cycle < count * 2; cycle++) {
      const timestamp = now + cycle * ACTIVITY_DISPLAY_TTL_MS;
      const signals = buildRollingActivitySignals({ ...feed, events, updatedAt: new Date(timestamp).toISOString() }, timestamp, now);
      expect(signals).toHaveLength(Math.min(3, count));
      expect(new Set(signals.map(signal => signal.eventId)).size).toBe(signals.length);
      for (const signal of signals) seen.add(signal.eventId);
    }
    expect(seen.size).toBe(count);
  }
});

test("remounting or refreshing cannot restart the first page or extend its lifetime", () => {
  const first = buildRollingActivitySignals(feed, now + 60_000);
  const refresh = now + 9 * 60_000;
  const remounted = buildRollingActivitySignals({...feed,updatedAt:new Date(refresh).toISOString()},refresh);
  expect(remounted.map(item=>item.id)).toEqual(first.map(item=>item.id));
  expect(remounted.map(item=>item.expiresAt)).toEqual(first.map(item=>item.expiresAt));
  const later = now + ACTIVITY_DISPLAY_TTL_MS;
  const rotated = buildRollingActivitySignals({...feed,updatedAt:new Date(later).toISOString()},later);
  expect(rotated.every(item=>!first.some(previous=>previous.id===item.id))).toBe(true);
});

test("small pools alternate daily and weekly priority and larger pools do so on return", () => {
  for (const count of [1, 2, 3, 6]) {
    const events = Array.from({ length: count }, (_, index) => ({ ...event, id: `polymarket-${73000 + index}` }));
    const pool = { ...feed, events };
    const first = buildRollingActivitySignals(pool, now, now);
    const later = now + Math.ceil(count / 3) * ACTIVITY_DISPLAY_TTL_MS;
    const returned = buildRollingActivitySignals({ ...pool, updatedAt: new Date(later).toISOString() }, later, now);
    expect(returned.map(item => item.eventId)).toEqual(first.map(item => item.eventId));
    expect(first[0].windowLabel).toBe("24H");
    expect(returned[0].windowLabel).toBe("7D");
  }
});

test("excludes stale feeds, expired markets, low market volume and invalid changes", () => {
  expect(buildRollingActivitySignals({ ...feed, updatedAt: new Date(now - 3_600_000).toISOString() }, now)).toEqual([]);
  expect(buildRollingActivitySignals({ ...feed, updatedAt: new Date(now + 61_000).toISOString() }, now)).toEqual([]);
  expect(buildRollingActivitySignals({ ...feed, dataMode: "fallback" }, now)).toEqual([]);
  for (const rejected of [
    { ...event, endDate: new Date(now - 1).toISOString() }, { ...event, marketVolume: 99_999 },
    { ...event, priceChange24h: .049, priceChange7d: -.199 },
    { ...event, priceChange24h: NaN, priceChange7d: Infinity },
  ]) expect(buildRollingActivitySignals({ ...feed, events: [rejected] }, now)).toEqual([]);
});

test("saved dismissals last only through their original expiry and stay bounded", () => {
  const saved = { active: now + 60_000, expired: now, invalid: "later", indefinite: Infinity, excessive: now + 16 * 60_000 };
  expect(activeActivityDismissals(saved, now)).toEqual({ active: now + 60_000 });
  expect(activeActivityDismissals(activeActivityDismissals(saved, now), now + 60_000)).toEqual({});
  expect(activeActivityDismissals(null, now)).toEqual({});
  expect(activeActivityDismissals([], now)).toEqual({});
  const many = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`notice-${index}`, now + 60_000]));
  expect(Object.keys(activeActivityDismissals(many, now))).toHaveLength(96);
});
