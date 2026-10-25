import { POLYMARKET_GAMMA_URL } from "@/lib/telegram-app/contracts";
import { HOT_MARKET_TAGS, hotMarketsFromEvents } from "@/lib/telegram-app/markets";

export const dynamic = "force-dynamic";

async function events(tag: string) {
  const url = `${POLYMARKET_GAMMA_URL}/events?tag_slug=${tag}&active=true&closed=false&order=volume24hr&ascending=false&limit=30`;
  const response = await fetch(url, { headers: { accept: "application/json" }, next: { revalidate: 60 }, signal: AbortSignal.timeout(8_000) }).catch(() => null);
  const json = response?.ok ? await response.json().catch(() => null) as unknown : null;
  return Array.isArray(json) ? json : [];
}

/** The Рынки tab: the hottest geopolitics and politics markets, and the biggest 24 h moves. */
export async function GET() {
  const lists = await Promise.all(HOT_MARKET_TAGS.map(events));
  const { hot, movers } = hotMarketsFromEvents(lists);
  if (!hot.length) return Response.json({ error: "Markets are temporarily unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  return Response.json({ generatedAt: new Date().toISOString(), hot, movers }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
