import { NextResponse } from "next/server";

import { getConflictPreviewFeed } from "@/lib/polymarket-conflict-preview";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  const feed = await getConflictPreviewFeed();
  const cacheSeconds = feed.dataMode === "live" ? 60 : 30;
  const browserCacheSeconds = feed.dataMode === "live" ? 30 : 15;
  const status =
    feed.dataMode === "live" || process.env.NODE_ENV !== "production"
      ? 200
      : 503;
  return NextResponse.json(feed, {
    status,
    headers: {
      "Cache-Control": `public, max-age=${browserCacheSeconds}, stale-while-revalidate=60, stale-if-error=900`,
      "CDN-Cache-Control": `public, max-age=${cacheSeconds}, stale-while-revalidate=60, stale-if-error=900`,
      "Vercel-CDN-Cache-Control": `public, max-age=${cacheSeconds}, stale-while-revalidate=60, stale-if-error=900`,
      ...(status === 503 ? { "Retry-After": "60" } : {}),
    },
  });
}
