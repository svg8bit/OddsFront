import { NextResponse } from "next/server";

import { getDropstabMarketStrip } from "@/lib/dropstab-market-strip";

const REFRESH_SECONDS = 15 * 60;

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const feed = await getDropstabMarketStrip();
  return NextResponse.json(feed, {
    status: 200,
    headers: {
      "Cache-Control":
        "public, max-age=30, stale-while-revalidate=120, stale-if-error=1800",
      "CDN-Cache-Control": `public, max-age=${REFRESH_SECONDS}, stale-while-revalidate=300, stale-if-error=1800`,
      "Vercel-CDN-Cache-Control": `public, max-age=${REFRESH_SECONDS}, stale-while-revalidate=300, stale-if-error=1800`,
    },
  });
}
