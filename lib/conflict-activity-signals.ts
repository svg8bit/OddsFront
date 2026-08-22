import type { ConflictPreviewFeed } from "@/features/global-conflict-map/preview/types";
import {
  isPolymarketActivityEventCurrent,
  POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME,
} from "@/lib/polymarket-activity-query";

const MAX_SIGNALS = 3;
export const MIN_MOVE_24H_POINTS = 5;
export const MIN_MOVE_7D_POINTS = 20;
const MIN_SIGNAL_FRESHNESS_MS = 10 * 60 * 1_000;

export type RollingActivitySignalKind = "odds-rise" | "odds-drop";

export interface RollingActivitySignal {
  id: string;
  kind: RollingActivitySignalKind;
  eventId: string;
  value: number;
  windowLabel: "24h" | "7d";
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
  windowLabel: "24h" | "7d",
  observedAt: number,
): RankedSignal | null {
  if (event.volume < POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME) {
    return null;
  }

  const rawChange =
    windowLabel === "24h" ? event.priceChange24h : event.priceChange7d;
  const value = priceChangePoints(rawChange);
  const threshold =
    windowLabel === "24h" ? MIN_MOVE_24H_POINTS : MIN_MOVE_7D_POINTS;
  if (
    rawChange === null ||
    !Number.isFinite(rawChange) ||
    value === null ||
    Math.abs(rawChange * 100) < threshold
  ) {
    return null;
  }

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

function strongestEventSignal(
  event: ConflictPreviewFeed["events"][number],
  observedAt: number,
): RankedSignal | null {
  const candidates = (["24h", "7d"] as const)
    .map((windowLabel) => rankedOddsSignal(event, windowLabel, observedAt))
    .filter((signal): signal is RankedSignal => Boolean(signal))
    .toSorted(
      (left, right) =>
        right.value - left.value ||
        (left.windowLabel === "24h" ? -1 : 1),
    );
  return candidates[0] ?? null;
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

  return currentEvents
    .map((event) => strongestEventSignal(event, observedAt))
    .filter((signal): signal is RankedSignal => Boolean(signal))
    .toSorted(strongestFirst)
    .slice(0, MAX_SIGNALS);
}
