import { NextResponse } from "next/server";

import { getConflictFeed } from "@/lib/polymarket";

export const dynamic = "force-dynamic";

export async function GET() {
  const feed = await getConflictFeed();
  return NextResponse.json(feed, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
