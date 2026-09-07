import type { ConflictPreviewFeed } from "@/features/global-conflict-map/preview/types";
import { PRICE_MOVE_MIN_POINTS, PRICE_MOVE_WINDOW_MS } from "@/lib/conflict-price-moves";
import { isPolymarketActivityEventCurrent, POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME } from "@/lib/polymarket-activity-query";

export interface RollingActivitySignal {
  id: string;
  kind: "odds-rise" | "odds-drop";
  eventId: string;
  value: number;
  windowLabel: "15m";
  observedAt: number;
}

export function buildRollingActivitySignals(feed: ConflictPreviewFeed, now = Date.now()): RollingActivitySignal[] {
  const feedTime = Date.parse(feed.updatedAt);
  if (feed.dataMode !== "live" || !Number.isFinite(feedTime) || feedTime > now + 60_000 || now - feedTime > 10 * 60_000) return [];
  return feed.events.flatMap((event): RollingActivitySignal[] => {
    const move = event.recentPriceMove;
    const occurredAt = Date.parse(move?.occurredAt ?? "");
    if (!isPolymarketActivityEventCurrent(event, now) ||
      (event.marketVolume ?? event.volume) < POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME ||
      !move || !Number.isFinite(move.changePoints) || Math.abs(move.changePoints) < PRICE_MOVE_MIN_POINTS ||
      !Number.isFinite(occurredAt) || occurredAt > now || now - occurredAt >= PRICE_MOVE_WINDOW_MS) return [];
    const kind = move.changePoints > 0 ? "odds-rise" : "odds-drop";
    return [{ id: `recent-15m-${event.id}-${kind}-${occurredAt}`, kind, eventId: event.id,
      value: Math.abs(move.changePoints), windowLabel: "15m", observedAt: occurredAt }];
  }).toSorted((a, b) => b.observedAt - a.observedAt || b.value - a.value || a.eventId.localeCompare(b.eventId)).slice(0, 3);
}
