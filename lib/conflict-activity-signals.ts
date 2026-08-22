import type { ConflictPreviewFeed } from "@/features/global-conflict-map/preview/types";
import {
  isPolymarketActivityEventCurrent,
  POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME,
} from "@/lib/polymarket-activity-query";

const MAX_SIGNALS = 3;
const MIN_ODDS_VOLUME_24H = 5_000;
export const MIN_MOVE_24H_POINTS = 20;
const MIN_SIGNAL_FRESHNESS_MS = 10 * 60 * 1_000;

export type RollingActivitySignalKind = "odds-rise" | "odds-drop";

export interface RollingActivitySignal {
  id: string;
  kind: RollingActivitySignalKind;
  eventId: string;
  value: number;
  windowLabel: "24h";
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
  observedAt: number,
): RankedSignal | null {
  if (
    event.volume < POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME ||
    event.volume24h < MIN_ODDS_VOLUME_24H
  ) {
    return null;
  }

  const rawChange = event.priceChange24h;
  const value = priceChangePoints(rawChange);
  if (
    rawChange === null ||
    value === null ||
    value < MIN_MOVE_24H_POINTS
  ) {
    return null;
  }

  const kind = rawChange > 0 ? "odds-rise" : "odds-drop";
  return {
    id: `rolling-24h-${event.id}-${kind}`,
    kind,
    eventId: event.id,
    value,
    windowLabel: "24h",
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

  return currentEvents
    .map((event) => rankedOddsSignal(event, observedAt))
    .filter((signal): signal is RankedSignal => Boolean(signal))
    .toSorted(strongestFirst)
    .slice(0, MAX_SIGNALS);
}
