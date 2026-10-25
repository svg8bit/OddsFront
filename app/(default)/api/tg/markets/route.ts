import { POLYMARKET_GAMMA_URL } from "@/lib/telegram-app/contracts";
import { HOT_MARKET_TAGS, hotMarketsFromEvents, mapAlert, moversWithAlerts, parseGammaMarket, type BinaryMarket } from "@/lib/telegram-app/markets";
import { localizeMarket, marketTranslations } from "@/lib/telegram-app/translations";
import { getConflictPreviewFeed } from "@/lib/polymarket-conflict-preview";

export const dynamic = "force-dynamic";

async function gamma(path: string) {
  const response = await fetch(`${POLYMARKET_GAMMA_URL}${path}`, { headers: { accept: "application/json" }, next: { revalidate: 60 }, signal: AbortSignal.timeout(8_000) }).catch(() => null);
  const json = response?.ok ? await response.json().catch(() => null) as unknown : null;
  return Array.isArray(json) ? json : [];
}

/** The OddsFront map's alerts: its markets whose odds moved past the activity-rail thresholds. */
async function mapAlerts(): Promise<BinaryMarket[]> {
  const feed = await getConflictPreviewFeed().catch(() => null);
  if (!feed || feed.dataMode !== "live") return [];
  const moving = feed.events
    .filter((event) => event.dataOrigin === "polymarket" && event.marketConditionId && mapAlert(event.priceChange24h, event.priceChange7d))
    .slice(0, 40);
  if (!moving.length) return [];
  const query = moving.map((event) => `condition_ids=${encodeURIComponent(event.marketConditionId!)}`).join("&");
  const rows = await gamma(`/markets?${query}&limit=${moving.length}`);
  return rows.flatMap((row) => {
    const market = parseGammaMarket(row);
    if (!market) return [];
    const event = moving.find((item) => item.marketConditionId?.toLowerCase() === market.conditionId.toLowerCase());
    const alert = event ? mapAlert(event.priceChange24h, event.priceChange7d) : null;
    return alert ? [{ ...market, alert }] : [];
  });
}

/** The Рынки tab: the biggest geopolitics and politics markets, and the map's alerts plus the biggest moves. */
export async function GET() {
  const [lists, alerts, ru] = await Promise.all([
    Promise.all(HOT_MARKET_TAGS.map((tag) => gamma(`/events?tag_slug=${tag}&active=true&closed=false&order=volume24hr&ascending=false&limit=40`))),
    mapAlerts(),
    marketTranslations(),
  ]);
  const { hot, movers } = hotMarketsFromEvents(lists);
  if (!hot.length) return Response.json({ error: "Markets are temporarily unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  return Response.json({
    generatedAt: new Date().toISOString(),
    hot: hot.map((market) => localizeMarket(market, ru)),
    movers: moversWithAlerts(alerts, movers).map((market) => localizeMarket(market, ru)),
  }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
