import { POLYMARKET_CLOB_URL } from "@/lib/telegram-app/contracts";

export const dynamic = "force-dynamic";

const MAX_POINTS = 84;

/** The Yes chance over the last 7 days for the bet sheet's chart (hourly, at most 84 points). */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^\d{10,100}$/.test(token)) return Response.json({ error: "Invalid token." }, { status: 400 });
  const response = await fetch(`${POLYMARKET_CLOB_URL}/prices-history?market=${token}&interval=1w&fidelity=60`, {
    headers: { accept: "application/json" },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(6_000),
  }).catch(() => null);
  const body = response?.ok ? await response.json().catch(() => null) as { history?: Array<{ p?: unknown }> } | null : null;
  const prices = (body?.history ?? []).map((point) => Number(point.p)).filter((price) => Number.isFinite(price) && price >= 0 && price <= 1);
  const step = Math.max(1, Math.ceil(prices.length / MAX_POINTS));
  const points = prices.filter((_, index) => index % step === 0 || index === prices.length - 1);
  return Response.json({ points }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
