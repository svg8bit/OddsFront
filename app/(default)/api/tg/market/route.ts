import { POLYMARKET_GAMMA_URL } from "@/lib/telegram-app/contracts";
import { parseGammaMarket } from "@/lib/telegram-app/markets";
import { localizeMarket, marketTranslations } from "@/lib/telegram-app/translations";

export const dynamic = "force-dynamic";

/** One Yes/No market by its Gamma id, with live prices (refreshed while the bet sheet is open). */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^\d{1,12}$/.test(id)) return Response.json({ error: "This market link is invalid." }, { status: 400 });
  const response = await fetch(`${POLYMARKET_GAMMA_URL}/markets?id=${id}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  const rows = response?.ok ? await response.json().catch(() => null) as unknown : null;
  const parsed = Array.isArray(rows) ? parseGammaMarket(rows[0]) : null;
  const market = parsed ? localizeMarket(parsed, await marketTranslations()) : null;
  if (!market) return Response.json({ error: "This market is no longer available." }, { status: 404, headers: { "Cache-Control": "public, s-maxage=30" } });
  return Response.json({ market }, { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" } });
}
