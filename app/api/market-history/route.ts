import { NextResponse } from "next/server";
import { getConflictPreviewFeed } from "@/lib/polymarket-conflict-preview";

export const dynamic = "force-dynamic";
const CLOB_HISTORY_URL = "https://clob.polymarket.com/prices-history";
type HistoryPoint = { t: number; p: number };

function normalizeHistory(value: unknown): HistoryPoint[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { history?: unknown }).history)) return [];
  const unique = new Map<number, HistoryPoint>();
  for (const candidate of (value as { history: unknown[] }).history) {
    if (!candidate || typeof candidate !== "object") continue;
    const t = Number((candidate as { t?: unknown }).t);
    const p = Number((candidate as { p?: unknown }).p);
    if (Number.isFinite(t) && Number.isFinite(p) && t > 0 && p >= 0 && p <= 1) unique.set(t, { t, p });
  }
  const points = [...unique.values()].sort((left, right) => left.t - right.t);
  if (points.length <= 96) return points;
  return Array.from({ length: 96 }, (_, index) => points[Math.round(index * (points.length - 1) / 95)]).filter((point): point is HistoryPoint => Boolean(point));
}

async function fetchHistory(token: string): Promise<HistoryPoint[]> {
  const url = new URL(CLOB_HISTORY_URL);
  url.searchParams.set("market", token);
  url.searchParams.set("interval", "max");
  url.searchParams.set("fidelity", "1440");
  const response = await fetch(url, { next: { revalidate: 900 }, headers: { Accept: "application/json" }, signal: AbortSignal.timeout(4_000) });
  return response.ok ? normalizeHistory(await response.json()) : [];
}

export async function GET(request: Request) {
  const ids = [...new Set((new URL(request.url).searchParams.get("eventIds") ?? "").split(",").filter((id) => /^polymarket-\d+$/.test(id)))].slice(0, 4);
  if (!ids.length) return NextResponse.json({ histories: {} }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const feed = await getConflictPreviewFeed();
  const selected = ids.map((id) => feed.events.find((event) => event.id === id)).filter((event) => event?.yesTokenId);
  const histories = Object.fromEntries(await Promise.all(selected.map(async (event) => {
    const points = await fetchHistory(event!.yesTokenId!);
    const last = points.at(-1);
    const current = event!.yesOdds / 100;
    if (last && Math.abs(last.p - current) > .001) points.push({ t: Math.max(last.t + 1, Math.floor(Date.now() / 1000)), p: current });
    return [event!.id, { points }] as const;
  })));
  return NextResponse.json({ updatedAt: new Date().toISOString(), histories }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=900, stale-while-revalidate=3600" } });
}
