import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { isRevalidationPath, MAX_REVALIDATION_PATHS } from "@/lib/news/revalidation";

// On-demand refresh for the news pages, sitemaps and feeds that a newly
// published (or retired) article changes. The VPS wire desk calls it once per
// run with a shared secret; marking a path stale costs nothing until the next
// request regenerates it, so this adds no renders of its own.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function authorized(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function POST(request: Request) {
  const secret = process.env.ODDSFRONT_NEWS_REVALIDATE_TOKEN;
  // Unconfigured deployments expose nothing.
  if (!secret || secret.length < 32) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  if (!authorized(request, secret)) return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const raw = await request.text();
  if (raw.length > 16_000) return Response.json({ error: "too_large" }, { status: 413, headers: NO_STORE });
  let paths: unknown;
  try { paths = (JSON.parse(raw) as { paths?: unknown }).paths; } catch { paths = null; }
  if (!Array.isArray(paths) || !paths.length || paths.length > MAX_REVALIDATION_PATHS || !paths.every(isRevalidationPath)) {
    return Response.json({ error: "invalid_paths" }, { status: 400, headers: NO_STORE });
  }
  for (const path of new Set(paths)) revalidatePath(path);
  return Response.json({ revalidated: new Set(paths).size, at: new Date().toISOString() }, { headers: NO_STORE });
}
