import { NextResponse } from "next/server";

import { getConflictPreviewFeed } from "@/lib/polymarket-conflict-preview";
import { withRecentPriceMoves } from "@/lib/polymarket-price-moves";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  const feed = await withRecentPriceMoves(await getConflictPreviewFeed());
  const cacheSeconds = feed.dataMode === "live" ? 15 : 0;
  const status =
    feed.dataMode === "live" || process.env.NODE_ENV !== "production"
      ? 200
      : 503;
  return NextResponse.json(feed, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "CDN-Cache-Control": status === 200 ? `public, max-age=${cacheSeconds}, stale-while-revalidate=15, stale-if-error=60` : "no-store",
      "Vercel-CDN-Cache-Control": status === 200 ? `public, max-age=${cacheSeconds}, stale-while-revalidate=15, stale-if-error=60` : "no-store",
      ...(status === 503 ? { "Retry-After": "60" } : {}),
    },
  });
}
