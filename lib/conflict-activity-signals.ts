import type { ConflictPreviewFeed } from "@/features/global-conflict-map/preview/types";
import { isPolymarketActivityEventCurrent, POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME } from "@/lib/polymarket-activity-query";

export const ACTIVITY_DISPLAY_TTL_MS = 15 * 60_000;
export interface RollingActivitySignal {
  id: string;
  kind: "odds-rise" | "odds-drop";
  eventId: string;
  value: number;
  windowLabel: "24H" | "7D";
  observedAt: number;
  expiresAt: number;
}

// Measurement period and screen lifetime are independent. These are current
// day/week changes, not claims that a sudden move happened in fifteen minutes.
export function buildRollingActivitySignals(feed: ConflictPreviewFeed, now = Date.now(), cycleStartedAt = now): RollingActivitySignal[] {
  const feedTime = Date.parse(feed.updatedAt);
  if (feed.dataMode !== "live" || !Number.isFinite(feedTime) || feedTime > now + 60_000 || now - feedTime > 10 * 60_000) return [];
  const cycle = cycleStartedAt + Math.max(0, Math.floor((now - cycleStartedAt) / ACTIVITY_DISPLAY_TTL_MS)) * ACTIVITY_DISPLAY_TTL_MS;
  const candidates = feed.events.flatMap((event): RollingActivitySignal[] => {
    if (!isPolymarketActivityEventCurrent(event, now) || (event.marketVolume ?? event.volume) < POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME) return [];
    return ([['24H', event.priceChange24h], ['7D', event.priceChange7d]] as const).flatMap(([windowLabel, change]): RollingActivitySignal[] => {
      if (change === null || !Number.isFinite(change) || Math.abs(change) < (windowLabel === "24H" ? .05 : .2) || Math.abs(change) > 1) return [];
      const kind = change > 0 ? "odds-rise" : "odds-drop";
      return [{ id: `rolling-${windowLabel}-${event.id}-${kind}-${cycle}`, kind, eventId: event.id,
        value: Math.round(Math.abs(change) * 1_000) / 10, windowLabel, observedAt: feedTime,
        expiresAt: cycle + ACTIVITY_DISPLAY_TTL_MS }];
    });
  }).toSorted((a, b) => b.value - a.value || a.eventId.localeCompare(b.eventId));
  // Reserve different markets for the next display cycle. Previously all
  // three eligible markets were immediately emitted again with new IDs, so
  // the visible cards appeared stuck despite their expiry timestamps changing.
  // Stable market ordering prevents a small price refresh reshuffling a page.
  const markets = [...new Set(candidates.map(item => item.eventId))].sort();
  const pageSize = Math.min(3, Math.max(1, Math.ceil(markets.length / 2)));
  const pageCount = Math.max(2, Math.ceil(markets.length / pageSize));
  const page = Math.floor((cycle - cycleStartedAt) / ACTIVITY_DISPLAY_TTL_MS) % pageCount;
  const pageMarkets = new Set(markets.slice(page * pageSize, (page + 1) * pageSize));
  const currentCandidates = candidates.filter(item => pageMarkets.has(item.eventId));
  const selected: RollingActivitySignal[] = [];
  const used = new Set<string>();
  const add = (candidate: RollingActivitySignal | undefined) => {
    if (candidate && !used.has(candidate.eventId)) { selected.push(candidate); used.add(candidate.eventId); }
  };
  // Keep both periods and directions when the current page supports them.
  for (const window of ["24H", "7D"] as const) {
    const group = currentCandidates.filter(item => item.windowLabel === window && !used.has(item.eventId));
    const opposite = group.filter(item => !selected.length || item.kind !== selected[0]!.kind);
    const pool = opposite.length ? opposite : group;
    if (pool.length) add(pool[0]);
  }
  for (const candidate of currentCandidates) {
    if (selected.length === 3) break;
    add(candidate);
  }
  return selected;
}
