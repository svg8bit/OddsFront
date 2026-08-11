import type { ConflictPreviewFeed } from "@/features/global-conflict-map/preview/types";
import {
  isPolymarketActivityEventCurrent,
  POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME,
} from "@/lib/polymarket-activity-query";

const MAX_SIGNALS = 3;
const MAX_ODDS_SIGNALS = 2;
const MIN_ODDS_VOLUME_24H = 5_000;
const MIN_MOVE_1H_POINTS = 1;
const MIN_MOVE_24H_POINTS = 3;
const MIN_HIGH_VOLUME_24H = 25_000;
const MIN_SIGNAL_FRESHNESS_MS = 10 * 60 * 1_000;

export type RollingActivitySignalKind =
  | "odds-rise"
  | "odds-drop"
  | "high-volume";

export interface RollingActivitySignal {
  id: string;
  kind: RollingActivitySignalKind;
  eventId: string;
  value: number;
  windowLabel: "1h" | "24h";
  observedAt: number;
}

interface RankedSignal extends RollingActivitySignal {
  score: number;
}

function priceChangePoints(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(Math.abs(value * 100) * 10) / 10;
}

function marketQualityScore(changePoints: number, volume24h: number): number {
  const liquidityWeight = 1 + Math.log10(Math.max(1, volume24h / 5_000));
  return changePoints * liquidityWeight;
}

function rankedOddsSignal(
  event: ConflictPreviewFeed["events"][number],
  windowLabel: "1h" | "24h",
  observedAt: number,
): RankedSignal | null {
  if (
    event.volume < POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME ||
    event.volume24h < MIN_ODDS_VOLUME_24H
  ) {
    return null;
  }

  const rawChange =
    windowLabel === "1h" ? event.priceChange1h : event.priceChange24h;
  const value = priceChangePoints(rawChange);
  const threshold =
    windowLabel === "1h" ? MIN_MOVE_1H_POINTS : MIN_MOVE_24H_POINTS;
  if (rawChange === null || value === null || value < threshold) return null;

  const kind = rawChange > 0 ? "odds-rise" : "odds-drop";
  return {
    id: `rolling-${windowLabel}-${event.id}-${kind}`,
    kind,
    eventId: event.id,
    value,
    windowLabel,
    observedAt,
    score: marketQualityScore(value, event.volume24h),
  };
}

function strongestFirst(left: RankedSignal, right: RankedSignal): number {
  return (
    right.score - left.score ||
    right.value - left.value ||
    left.eventId.localeCompare(right.eventId)
  );
}

export function buildRollingActivitySignals(
  feed: ConflictPreviewFeed,
  now = Date.now(),
): RollingActivitySignal[] {
  if (feed.dataMode !== "live") return [];
  const observedAt = Date.parse(feed.updatedAt);
  const maximumAge = Math.max(
    MIN_SIGNAL_FRESHNESS_MS,
    feed.refreshSeconds * 3 * 1_000,
  );
  if (
    !Number.isFinite(observedAt) ||
    observedAt > now + 60_000 ||
    now - observedAt > maximumAge
  ) {
    return [];
  }

  const currentEvents = feed.events.filter((event) =>
    isPolymarketActivityEventCurrent(event, now),
  );

  const oneHour = currentEvents
    .map((event) => rankedOddsSignal(event, "1h", observedAt))
    .filter((signal): signal is RankedSignal => Boolean(signal))
    .toSorted(strongestFirst);
  const oneDay = currentEvents
    .map((event) => rankedOddsSignal(event, "24h", observedAt))
    .filter((signal): signal is RankedSignal => Boolean(signal))
    .toSorted(strongestFirst);
  const selected: RollingActivitySignal[] = [];
  const selectedEventIds = new Set<string>();

  const add = (signal: RollingActivitySignal | undefined) => {
    if (!signal || selectedEventIds.has(signal.eventId)) return false;
    selected.push(signal);
    selectedEventIds.add(signal.eventId);
    return true;
  };

  add(oneHour[0]);
  add(oneDay.find((signal) => !selectedEventIds.has(signal.eventId)));
  if (selected.length < MAX_ODDS_SIGNALS) {
    for (const signal of [...oneHour, ...oneDay].toSorted(strongestFirst)) {
      add(signal);
      if (selected.length >= MAX_ODDS_SIGNALS) break;
    }
  }

  const volumeLeaders = currentEvents
    .filter(
      (event) =>
        event.volume >= POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME &&
        event.volume24h >= MIN_HIGH_VOLUME_24H &&
        !selectedEventIds.has(event.id),
    )
    .toSorted(
      (left, right) =>
        right.volume24h - left.volume24h || right.volume - left.volume,
    );
  for (const event of volumeLeaders) {
    add({
      id: `rolling-volume-${event.id}`,
      kind: "high-volume",
      eventId: event.id,
      value: event.volume24h,
      windowLabel: "24h",
      observedAt,
    });
    if (selected.length >= MAX_SIGNALS) break;
  }

  return selected.slice(0, MAX_SIGNALS);
}
