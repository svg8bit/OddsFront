import { expect, test } from "@playwright/test";
import { getConflictPreviewFixtureFeed } from "../features/global-conflict-map/preview/fixture";
import { getInitialActivityClock } from "../lib/activity-notice-lifecycle";
import { buildRollingActivitySignals } from "../lib/conflict-activity-signals";
import { recentPriceMove } from "../lib/conflict-price-moves";

const now = Date.parse("2026-09-07T13:00:00Z");
const fixture = getConflictPreviewFixtureFeed();
const event = { ...fixture.events[0]!, id: "polymarket-73000", volume: 2_000_000, marketVolume: 200_000,
  marketConditionId: `0x${"1".padStart(64, "0")}`, endDate: new Date(now + 86_400_000).toISOString(),
  updatedAt: new Date(now).toISOString(), priceChange24h: .3, priceChange7d: .7 };
const feed = { ...fixture, dataMode: "live" as const, updatedAt: new Date(now).toISOString(), events: [event] };
const history = Array.from({ length: 31 }, (_, minute) => ({ t: now / 1_000 - (30 - minute) * 60, p: minute < 22 ? .5 : .58 }));

test("uses a deterministic feed clock", () => {
  expect(getInitialActivityClock(feed.updatedAt)).toBe(now);
  expect(getInitialActivityClock("invalid")).toBe(0);
});

test("daily and weekly leaders without a confirmed recent move do not become alerts", () => {
  expect(buildRollingActivitySignals(feed, now)).toEqual([]);
  expect(recentPriceMove(history.map(point => ({ ...point, p: .99 })), now)).toBeNull();
});

test("unchanged minute samples and refreshed feeds cannot renew the actual movement time", () => {
  const movement = recentPriceMove(history, now)!;
  expect(movement.changePoints).toBe(8);
  expect(movement.occurredAt).toBe(new Date(now - 8 * 60_000).toISOString());
  const fresh = { ...feed, events: [{ ...event, recentPriceMove: movement }] };
  const first = buildRollingActivitySignals(fresh, now)[0]!;
  const laterHistory = [...history, ...Array.from({ length: 5 }, (_, i) => ({ t: now / 1_000 + (i + 1) * 60, p: .58 }))];
  const laterMove = recentPriceMove(laterHistory, now + 5 * 60_000)!;
  expect(laterMove).toEqual(movement);
  const refreshed = buildRollingActivitySignals({ ...fresh, updatedAt: new Date(now + 5 * 60_000).toISOString() }, now + 5 * 60_000)[0]!;
  expect(refreshed).toEqual(first);
  expect(buildRollingActivitySignals({ ...fresh, updatedAt: new Date(now + 8 * 60_000).toISOString() }, now + 8 * 60_000)).toEqual([]);
});

test("requires continuous, current history and rejects gaps, future data and small moves", () => {
  expect(recentPriceMove(history.slice(0, -5), now)).toBeNull();
  expect(recentPriceMove(history.filter((_, i) => i < 15 || i > 23), now)).toBeNull();
  expect(recentPriceMove(history.map(point => ({ ...point, t: point.t + 3_600 })), now)).toBeNull();
  expect(recentPriceMove(history.map(point => ({ ...point, p: point.p === .58 ? .549 : .5 })), now)).toBeNull();
  expect(recentPriceMove([{ t: now / 1_000, p: null }, { t: now / 1_000, p: NaN }], now)).toBeNull();
});

test("supports both directions and excludes expired or insufficiently liquid individual markets", () => {
  const movement = recentPriceMove(history.map(point => ({ ...point, p: 1 - point.p })), now)!;
  expect(movement.changePoints).toBe(-8);
  const confirmed = { ...event, recentPriceMove: movement };
  expect(buildRollingActivitySignals({ ...feed, events: [confirmed] }, now)[0]).toMatchObject({ kind: "odds-drop", value: 8, windowLabel: "15m", observedAt: now - 8 * 60_000 });
  for (const rejected of [{ ...confirmed, endDate: new Date(now - 1).toISOString() }, { ...confirmed, marketVolume: 99_999 }]) {
    expect(buildRollingActivitySignals({ ...feed, events: [rejected] }, now)).toEqual([]);
  }
  expect(buildRollingActivitySignals({ ...feed, updatedAt: new Date(now - 3_600_000).toISOString(), events: [confirmed] }, now)).toEqual([]);
});
