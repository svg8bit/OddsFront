import { getConflictPreviewFeed, normalizePolymarketImageUrl } from "@/lib/polymarket-conflict-preview";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function unavailable(status: number) {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  if (!/^polymarket-[0-9]+$/.test(eventId)) return unavailable(400);

  const feed = await getConflictPreviewFeed();
  const event = feed.events.find(candidate => candidate.id === eventId);
  const imageUrl = normalizePolymarketImageUrl(event?.imageUrl);
  if (!imageUrl) return unavailable(404);

  try {
    const upstream = await fetch(imageUrl, {
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
    const advertisedSize = Number(upstream.headers.get("content-length") ?? "0");
    if (
      !upstream.ok ||
      !contentType ||
      !ALLOWED_IMAGE_TYPES.has(contentType) ||
      (advertisedSize > 0 && advertisedSize > MAX_IMAGE_BYTES) ||
      normalizePolymarketImageUrl(upstream.url) === null
    ) return unavailable(502);

    const body = await upstream.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_IMAGE_BYTES) return unavailable(502);
    return new Response(body, {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        "Content-Length": String(body.byteLength),
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return unavailable(502);
  }
}
