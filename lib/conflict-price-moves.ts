import type { ConflictPreviewEvent, RecentPriceMove } from "@/features/global-conflict-map/preview/types";
import { isPolymarketActivityEventCurrent, POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME } from "@/lib/polymarket-activity-query";

export const PRICE_MOVE_WINDOW_MS = 15 * 60_000;
export const PRICE_MOVE_MIN_POINTS = 5;
const MAX_SAMPLE_GAP_MS = 3 * 60_000;

type PricePoint = { t: number; p: number };

export function normalizePriceHistory(value: unknown, now: number): PricePoint[] {
  if (!Array.isArray(value)) return [];
  const points = new Map<number, PricePoint>();
  for (const row of value.slice(0, 2_000)) {
    if (!row || typeof row !== "object") continue;
    const { t, p } = row as Partial<PricePoint>;
    if (typeof t !== "number" || typeof p !== "number" || !Number.isFinite(t) || !Number.isFinite(p) ||
      p < 0 || p > 1 || t * 1_000 > now || t * 1_000 < now - 2 * PRICE_MOVE_WINDOW_MS - MAX_SAMPLE_GAP_MS) continue;
    points.set(t, { t, p });
  }
  return [...points.values()].sort((a, b) => a.t - b.t);
}

export function recentPriceMove(value: unknown, now = Date.now()): RecentPriceMove | null {
  const points = normalizePriceHistory(value, now);
  const latest = points.at(-1);
  if (!latest || now - latest.t * 1_000 > MAX_SAMPLE_GAP_MS) return null;
  let movement: RecentPriceMove | null = null;
  for (let end = 1; end < points.length; end += 1) {
    const current = points[end]!;
    const previous = points[end - 1]!;
    const occurredAt = current.t * 1_000;
    // Unchanged minute samples do not create a new occurrence or renew expiry.
    if (current.p === previous.p || occurredAt <= now - PRICE_MOVE_WINDOW_MS) continue;
    let start = end - 1;
    while (start > 0 && (current.t - points[start - 1]!.t) * 1_000 <= PRICE_MOVE_WINDOW_MS) start -= 1;
    const baseline = points[start]!;
    if ((current.t - baseline.t) * 1_000 < PRICE_MOVE_WINDOW_MS - MAX_SAMPLE_GAP_MS) continue;
    if (points.slice(start + 1, end + 1).some((point, i) => (point.t - points[start + i]!.t) * 1_000 > MAX_SAMPLE_GAP_MS)) continue;
    const changePoints = (current.p - baseline.p) * 100;
    if (Math.abs(changePoints) + 1e-8 < PRICE_MOVE_MIN_POINTS) continue;
    movement = {
      changePoints: Math.round(changePoints * 10) / 10,
      occurredAt: new Date(occurredAt).toISOString(),
      fromProbability: baseline.p,
      toProbability: current.p,
    };
  }
  return movement;
}

export function priceMoveMarketEligible(event: ConflictPreviewEvent, now = Date.now()): boolean {
  return isPolymarketActivityEventCurrent(event, now) &&
    (event.marketVolume ?? event.volume) >= POLYMARKET_ACTIVITY_EVENT_MIN_VOLUME &&
    typeof event.yesTokenId === "string" && /^\d{1,80}$/.test(event.yesTokenId);
}
